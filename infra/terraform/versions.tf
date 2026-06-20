terraform {
  required_version = ">= 1.6.0"
  required_providers {
    # Cluster stub only (BOOT-0). Swap for your provider (hcloud, civo, scaleway, bare-metal k3s, ...).
    # All free/self-hostable options; no paid SaaS required (§A3).
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.30.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.13.0"
    }
  }
}
