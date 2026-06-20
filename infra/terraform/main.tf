# Cluster bootstrap stub (BOOT-0). Creates the primary namespace and a place to install
# ArgoCD. The full platform (operators, mesh, observability) is GitOps-managed by ArgoCD
# from deploy/ — Terraform's job stops at "a cluster with ArgoCD" (§A22).

provider "kubernetes" {
  config_path = var.kubeconfig_path
}

provider "helm" {
  kubernetes {
    config_path = var.kubeconfig_path
  }
}

resource "kubernetes_namespace" "app" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/part-of" = "velchat"
    }
  }
}

resource "kubernetes_namespace" "argocd" {
  metadata {
    name = "argocd"
  }
}

# Install ArgoCD (then point it at deploy/argocd/app-of-apps.yaml).
resource "helm_release" "argocd" {
  name       = "argocd"
  namespace  = kubernetes_namespace.argocd.metadata[0].name
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = "7.7.0"
}
