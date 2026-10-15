#!/usr/bin/env bash
# Creates VM121 tce-scan-worker-01 on an isolated bridge (vmbr60). The bridge
# must already exist with 192.168.60.1/24 on the host side; this script checks
# for it and stops rather than editing the host's network configuration, which
# requires approval.
set -euo pipefail

VMID=${VMID:-121}
NAME=${NAME:-tce-scan-worker-01}
TEMPLATE=${TEMPLATE:-9000}
BRIDGE=${BRIDGE:-vmbr60}
IPCIDR=${IPCIDR:-192.168.60.10/24}
GATEWAY=${GATEWAY:-192.168.60.1}
CORES=${CORES:-2}
MEMORY=${MEMORY:-4096}
DISK=${DISK:-30}
STORAGE=${STORAGE:-local-lvm}
SSHKEYS=${SSHKEYS:-/root/.ssh/authorized_keys}

qm=/usr/sbin/qm

if ! ip link show "$BRIDGE" >/dev/null 2>&1; then
  cat >&2 <<EOF
$BRIDGE does not exist. It carries the worker's only network, and creating it
changes the host's network configuration, so it is not done here. Proposed:

  auto $BRIDGE
  iface $BRIDGE inet static
      address ${GATEWAY}/24
      bridge-ports none
      bridge-stp off
      bridge-fd 0

plus NAT for 192.168.60.0/24 out of vmbr0, matching the existing vmbr50 rule.
EOF
  exit 1
fi

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
$qm set "$VMID" --onboot 1 --description "TCecure External Exposure Snapshot - worker (isolated egress)"
$qm resize "$VMID" scsi0 "${DISK}G"
$qm start "$VMID"
set +x

echo "VM $VMID started at ${IPCIDR%%/*}."
echo "Apply ops/worker-nftables.conf inside the guest before starting the worker."
