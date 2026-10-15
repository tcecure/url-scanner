#!/usr/bin/env bash
# Creates VM120 tce-scan-web-01 on pve2 from the existing Ubuntu cloud template.
# Idempotent: it refuses to touch a VM that already exists, and it never
# modifies any other VM, the datacenter firewall or the host.
set -euo pipefail

VMID=${VMID:-120}
NAME=${NAME:-tce-scan-web-01}
TEMPLATE=${TEMPLATE:-9000}
BRIDGE=${BRIDGE:-vmbr0}
IPCIDR=${IPCIDR:-192.168.1.120/24}
GATEWAY=${GATEWAY:-192.168.1.1}
CORES=${CORES:-4}
MEMORY=${MEMORY:-8192}
DISK=${DISK:-60}
STORAGE=${STORAGE:-local-lvm}
SSHKEYS=${SSHKEYS:-/root/.ssh/authorized_keys}

qm=/usr/sbin/qm

if $qm status "$VMID" >/dev/null 2>&1; then
  echo "VM $VMID already exists; nothing to do." >&2
  exit 0
fi

set -x
$qm clone "$TEMPLATE" "$VMID" --name "$NAME" --full --storage "$STORAGE"
$qm set "$VMID" --cores "$CORES" --memory "$MEMORY" --agent 1
$qm set "$VMID" --net0 "virtio,bridge=$BRIDGE"
$qm set "$VMID" --ipconfig0 "ip=$IPCIDR,gw=$GATEWAY"
$qm set "$VMID" --sshkeys "$SSHKEYS"
$qm set "$VMID" --onboot 1 --description "TCecure External Exposure Snapshot - web tier"
$qm resize "$VMID" scsi0 "${DISK}G"
$qm start "$VMID"
set +x

echo "VM $VMID started at ${IPCIDR%%/*}. Continue with docs/install.md step 2."
