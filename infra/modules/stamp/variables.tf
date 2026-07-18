variable "stamp_name" {
  type = string # e.g. "staging", "acme-recruiting"
}

variable "project_id" {
  type = string
}

variable "org_id" {
  type = string
}

variable "folder_id" {
  type    = string
  default = null # clients/ folder
}

variable "billing_account" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "app_image" {
  type = string # full AR path incl. tag
}

variable "migrate_image" {
  type = string
}

variable "n8n_image" {
  type    = string
  default = "docker.n8n.io/n8nio/n8n:1.99.1"
}

variable "db_tier" {
  type    = string
  default = "db-g1-small"
}

variable "deployer_sa" {
  type = string # from ops outputs
}

variable "alert_email" {
  type = string
}

variable "custom_domain" {
  type    = string
  default = null
}

variable "app_min_instances" {
  type    = number
  default = 0
}

variable "jobdiva_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "jobdiva_username" {
  type      = string
  sensitive = true
  default   = ""
}

variable "jobdiva_password" {
  type      = string
  sensitive = true
  default   = ""
}
