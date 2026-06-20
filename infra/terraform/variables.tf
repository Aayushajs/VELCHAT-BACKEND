variable "cluster_name" {
  type        = string
  default     = "velchat"
  description = "Kubernetes cluster name."
}

variable "kubeconfig_path" {
  type        = string
  default     = "~/.kube/config"
  description = "Path to kubeconfig for the target cluster."
}

variable "namespace" {
  type        = string
  default     = "velchat-prod"
  description = "Primary application namespace."
}
