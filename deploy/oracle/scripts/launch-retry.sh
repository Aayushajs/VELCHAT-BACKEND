#!/usr/bin/env bash
# Launch an Always Free A1 instance, retrying until Oracle has capacity.
#
# "Out of host capacity" is the normal response for A1, not an error in your setup — the shape is
# in constant demand. Retrying in a loop is the accepted workaround and usually succeeds within
# hours. Run this in tmux and leave it.
#
# Prereqs: OCI CLI configured (`oci setup config`), and the variables below filled in.
set -euo pipefail

: "${COMPARTMENT_ID:?export COMPARTMENT_ID=ocid1.compartment...}"
: "${SUBNET_ID:?export SUBNET_ID=ocid1.subnet...}"
: "${IMAGE_ID:?export IMAGE_ID=ocid1.image...   # Ubuntu 22.04 aarch64}"
: "${SSH_KEY_FILE:?export SSH_KEY_FILE=~/.ssh/id_rsa.pub}"
DISPLAY_NAME="${DISPLAY_NAME:-velchat}"
OCPUS="${OCPUS:-2}"          # the whole Always Free A1 allowance
MEMORY_GB="${MEMORY_GB:-12}"
SLEEP_SECONDS="${SLEEP_SECONDS:-60}"

# Try every availability domain: capacity is per-AD, so one may free up while another is full.
mapfile -t ADS < <(oci iam availability-domain list --compartment-id "$COMPARTMENT_ID" \
  --query 'data[].name' --raw-output | tr -d '[]"," ' | grep -v '^$')

attempt=0
while true; do
  attempt=$((attempt + 1))
  for ad in "${ADS[@]}"; do
    echo "[$(date +%H:%M:%S)] attempt $attempt in $ad ..."
    if oci compute instance launch \
      --availability-domain "$ad" \
      --compartment-id "$COMPARTMENT_ID" \
      --shape VM.Standard.A1.Flex \
      --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
      --image-id "$IMAGE_ID" \
      --subnet-id "$SUBNET_ID" \
      --display-name "$DISPLAY_NAME" \
      --assign-public-ip true \
      --ssh-authorized-keys-file "$SSH_KEY_FILE" \
      --wait-for-state RUNNING 2>/tmp/oci-launch.err; then
      echo "LAUNCHED in $ad after $attempt attempt(s)."
      exit 0
    fi
    if ! grep -qi "out of host capacity\|OutOfCapacity\|LimitExceeded" /tmp/oci-launch.err; then
      echo "Failed for a reason that retrying will not fix:"; cat /tmp/oci-launch.err; exit 1
    fi
  done
  sleep "$SLEEP_SECONDS"
done
