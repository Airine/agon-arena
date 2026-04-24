#!/usr/bin/env bash

set -euo pipefail

REPO_TARBALL_URL="https://codeload.github.com/Airine/agon-arena/tar.gz/refs/heads/master"
PACKAGE_SUBDIR="agon-arena-master/sdks/agent-skill"
AGON_HOME="${AGON_HOME:-${AGON_AGENT_HOME:-$HOME/.agon/agent-skill}}"
DEFAULT_BIN_DIR="${HOME}/.local/bin"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

detect_bin_dir() {
  if [ -d "${DEFAULT_BIN_DIR}" ] || printf '%s' "${PATH}" | tr ':' '\n' | grep -Fxq "${DEFAULT_BIN_DIR}"; then
    printf '%s\n' "${DEFAULT_BIN_DIR}"
    return
  fi
  if [ -d "${HOME}/bin" ] || printf '%s' "${PATH}" | tr ':' '\n' | grep -Fxq "${HOME}/bin"; then
    printf '%s\n' "${HOME}/bin"
    return
  fi
  printf '%s\n' "${DEFAULT_BIN_DIR}"
}

check_node() {
  require_command node
  require_command npm
  NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [ "${NODE_MAJOR}" -lt 20 ]; then
    echo "Node.js >= 20 is required. Found $(node -v)." >&2
    exit 1
  fi
}

install_package_home() {
  local tmp_dir archive_root
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  require_command curl
  require_command tar
  curl -fsSL "${REPO_TARBALL_URL}" | tar -xz -C "${tmp_dir}"
  archive_root="${tmp_dir}/${PACKAGE_SUBDIR}"

  mkdir -p "${AGON_HOME}"
  rm -rf "${AGON_HOME}/bin" \
         "${AGON_HOME}/commands" \
         "${AGON_HOME}/lib" \
         "${AGON_HOME}/skill" \
         "${AGON_HOME}/tools"
  cp -R "${archive_root}/bin" "${AGON_HOME}/bin"
  cp -R "${archive_root}/commands" "${AGON_HOME}/commands"
  cp -R "${archive_root}/lib" "${AGON_HOME}/lib"
  cp -R "${archive_root}/skill" "${AGON_HOME}/skill"
  cp -R "${archive_root}/tools" "${AGON_HOME}/tools"
  cp "${archive_root}/package.json" "${AGON_HOME}/package.json"
  cp "${archive_root}/README.md" "${AGON_HOME}/README.md"
  (cd "${AGON_HOME}" && npm install --omit=dev)
}

install_cli_wrapper() {
  local bin_dir wrapper_path
  bin_dir="$(detect_bin_dir)"
  mkdir -p "${bin_dir}"
  wrapper_path="${bin_dir}/agon"

cat > "${wrapper_path}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
AGON_HOME="\${AGON_HOME:-\${AGON_AGENT_HOME:-${AGON_HOME}}}"
exec node "\${AGON_HOME}/bin/agon.js" "\$@"
EOF
  chmod +x "${wrapper_path}"

  if ! printf '%s' "${PATH}" | tr ':' '\n' | grep -Fxq "${bin_dir}"; then
    echo "Installed agon to ${wrapper_path}" >&2
    echo "Add ${bin_dir} to PATH to run it directly." >&2
  fi
}

sync_skill_dirs() {
  local skill_name="agon"
  local source_dir="${AGON_HOME}/skill"
  local targets=(
    "${HOME}/.codex/skills/${skill_name}"
    "${HOME}/.claude/skills/${skill_name}"
    "${HOME}/.config/claude/skills/${skill_name}"
  )

  for target in "${targets[@]}"; do
    if [ -d "$(dirname "${target}")" ]; then
      mkdir -p "${target}"
      rm -rf "${target}/SKILL.md" "${target}/references" "${target}/assets" "${target}/scripts"
      cp "${source_dir}/SKILL.md" "${target}/SKILL.md"
      cp -R "${source_dir}/references" "${target}/references"
      cp -R "${source_dir}/assets" "${target}/assets"
      cp -R "${source_dir}/scripts" "${target}/scripts"
    fi
  done
}

main() {
  check_node
  install_package_home
  install_cli_wrapper
  sync_skill_dirs

  echo "Agon CLI skill installed under ${AGON_HOME}"
  echo "Run: agon --help"
}

main "$@"
