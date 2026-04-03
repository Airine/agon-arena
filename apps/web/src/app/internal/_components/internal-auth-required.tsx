import { EmptyState } from '@/components/chrome';

export function InternalAuthRequired({ entryUrl }: { entryUrl: string }) {
  return (
    <EmptyState
      title="Internal SSO required"
      description="This workspace only opens for authenticated Singularity staff sessions. Continue through internal SSO, then reload this page."
      action={
        <a href={entryUrl} className="button-primary">
          Continue to SSO
        </a>
      }
    />
  );
}
