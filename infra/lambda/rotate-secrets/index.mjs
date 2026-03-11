/**
 * Secrets Manager rotation Lambda for Agon Arena.
 *
 * Handles rotation for:
 * - JWT_SECRET: generates a new 64-byte hex secret
 * - DB password: generates a new 32-char password and updates RDS
 * - Ed25519 key: generates a new Ed25519 keypair (hex-encoded private key)
 *
 * After DB password or Ed25519 key rotation, triggers an ECS force-new-deployment
 * so running tasks pick up the new secret values.
 *
 * Follows the Secrets Manager rotation protocol:
 * https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets-lambda-function-overview.html
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
  UpdateSecretVersionStageCommand,
} from "@aws-sdk/client-secrets-manager";
import { RDSClient, ModifyDBInstanceCommand } from "@aws-sdk/client-rds";
import { ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";
import { randomBytes, generateKeyPairSync } from "node:crypto";

const smClient = new SecretsManagerClient();
const rdsClient = new RDSClient();
const ecsClient = new ECSClient();

export async function handler(event) {
  const { SecretId: secretArn, ClientRequestToken: token, Step: step } = event;

  // Validate the secret version
  const metadata = await smClient.send(
    new DescribeSecretCommand({ SecretId: secretArn })
  );

  const versions = metadata.VersionIdsToStages || {};
  if (!(token in versions)) {
    throw new Error(`Secret version ${token} has no stage for rotation.`);
  }

  const stages = versions[token];
  if (stages.includes("AWSCURRENT")) {
    console.log(`Secret version ${token} already set as AWSCURRENT.`);
    return;
  }
  if (!stages.includes("AWSPENDING")) {
    throw new Error(`Secret version ${token} not set as AWSPENDING.`);
  }

  // Determine secret type from name
  const secretName = metadata.Name || "";
  const isJwtSecret = secretName.includes("jwt-secret");
  const isDbPassword = secretName.includes("db-password");
  const isEd25519Key = secretName.includes("ed25519-key");

  switch (step) {
    case "createSecret":
      await createSecret(secretArn, token, { isJwtSecret, isDbPassword, isEd25519Key });
      break;
    case "setSecret":
      await setSecret(secretArn, token, { isDbPassword });
      break;
    case "testSecret":
      await testSecret(secretArn, token);
      break;
    case "finishSecret":
      await finishSecret(secretArn, token, metadata, { isDbPassword, isEd25519Key });
      break;
    default:
      throw new Error(`Unknown step: ${step}`);
  }
}

async function createSecret(secretArn, token, { isJwtSecret, isDbPassword, isEd25519Key }) {
  // Check if a pending version already exists
  try {
    await smClient.send(
      new GetSecretValueCommand({
        SecretId: secretArn,
        VersionId: token,
        VersionStage: "AWSPENDING",
      })
    );
    console.log("createSecret: pending version already exists.");
    return;
  } catch (err) {
    if (err.name !== "ResourceNotFoundException") throw err;
  }

  let newSecret;

  if (isJwtSecret) {
    newSecret = JSON.stringify({
      JWT_SECRET: randomBytes(64).toString("hex"),
    });
  } else if (isDbPassword) {
    // Generate a strong password (no ambiguous chars for connection string safety)
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!#$%&*-_=+";
    let password = "";
    const bytes = randomBytes(32);
    for (let i = 0; i < 32; i++) {
      password += chars[bytes[i] % chars.length];
    }
    newSecret = password;
  } else if (isEd25519Key) {
    // Generate a new Ed25519 keypair
    const { privateKey } = generateKeyPairSync("ed25519");
    const pkcs8Der = privateKey.export({ type: "pkcs8", format: "der" });
    // Store the raw 32-byte seed (last 32 bytes of the 48-byte PKCS#8 DER encoding)
    const seed = pkcs8Der.subarray(pkcs8Der.length - 32);
    newSecret = seed.toString("hex");
  } else {
    // Generic secret: 48-byte random hex
    newSecret = randomBytes(48).toString("hex");
  }

  await smClient.send(
    new PutSecretValueCommand({
      SecretId: secretArn,
      ClientRequestToken: token,
      SecretString: newSecret,
      VersionStages: ["AWSPENDING"],
    })
  );

  console.log("createSecret: new pending version created.");
}

async function setSecret(secretArn, token, { isDbPassword }) {
  if (!isDbPassword) {
    console.log("setSecret: not a DB password, skipping RDS update.");
    return;
  }

  // Get the pending password
  const pending = await smClient.send(
    new GetSecretValueCommand({
      SecretId: secretArn,
      VersionId: token,
      VersionStage: "AWSPENDING",
    })
  );

  const dbInstanceId = process.env.DB_INSTANCE_ID;
  if (!dbInstanceId) {
    throw new Error("DB_INSTANCE_ID environment variable not set.");
  }

  // Update the RDS master password
  await rdsClient.send(
    new ModifyDBInstanceCommand({
      DBInstanceIdentifier: dbInstanceId,
      MasterUserPassword: pending.SecretString,
      ApplyImmediately: true,
    })
  );

  console.log(`setSecret: RDS password updated for ${dbInstanceId}.`);
}

async function testSecret(secretArn, token) {
  // Verify the pending secret is readable
  await smClient.send(
    new GetSecretValueCommand({
      SecretId: secretArn,
      VersionId: token,
      VersionStage: "AWSPENDING",
    })
  );
  console.log("testSecret: pending secret is readable.");
}

async function finishSecret(secretArn, token, metadata, { isDbPassword, isEd25519Key }) {
  const versions = metadata.VersionIdsToStages || {};

  // Find the current version
  let currentVersion = null;
  for (const [versionId, stages] of Object.entries(versions)) {
    if (stages.includes("AWSCURRENT") && versionId !== token) {
      currentVersion = versionId;
      break;
    }
  }

  // Move AWSCURRENT to the new version
  await smClient.send(
    new UpdateSecretVersionStageCommand({
      SecretId: secretArn,
      VersionStage: "AWSCURRENT",
      MoveToVersionId: token,
      RemoveFromVersionId: currentVersion,
    })
  );

  console.log(
    `finishSecret: version ${token} is now AWSCURRENT (was ${currentVersion}).`
  );

  // Force ECS redeployment so running tasks pick up the new secret
  if (isDbPassword || isEd25519Key) {
    await forceEcsRedeployment();
  }
}

async function forceEcsRedeployment() {
  const cluster = process.env.ECS_CLUSTER_NAME;
  const service = process.env.ECS_SERVICE_NAME;

  if (!cluster || !service) {
    console.log("forceEcsRedeployment: ECS_CLUSTER_NAME or ECS_SERVICE_NAME not set, skipping.");
    return;
  }

  await ecsClient.send(
    new UpdateServiceCommand({
      cluster,
      service,
      forceNewDeployment: true,
    })
  );

  console.log(`forceEcsRedeployment: triggered new deployment for ${cluster}/${service}.`);
}
