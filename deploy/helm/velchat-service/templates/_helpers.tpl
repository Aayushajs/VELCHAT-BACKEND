{{- define "velchat-service.name" -}}
{{- .Values.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "velchat-service.labels" -}}
app.kubernetes.io/name: {{ include "velchat-service.name" . }}
app.kubernetes.io/part-of: velchat
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "velchat-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "velchat-service.name" . }}
{{- end -}}
