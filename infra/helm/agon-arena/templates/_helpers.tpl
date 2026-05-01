{{- define "agon-arena.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "agon-arena.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "agon-arena.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "agon-arena.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "agon-arena.labels" -}}
helm.sh/chart: {{ include "agon-arena.chart" . }}
app.kubernetes.io/name: {{ include "agon-arena.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "agon-arena.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agon-arena.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "agon-arena.apiSecretName" -}}
{{- default (printf "%s-app" (include "agon-arena.fullname" .)) .Values.api.existingSecretName -}}
{{- end -}}

{{- define "agon-arena.postgresqlSecretName" -}}
{{- default (printf "%s-postgres" (include "agon-arena.fullname" .)) .Values.postgresql.existingSecretName -}}
{{- end -}}

{{- define "agon-arena.postgresqlHost" -}}
{{- if .Values.postgresql.hostOverride -}}
{{- .Values.postgresql.hostOverride -}}
{{- else -}}
{{- printf "%s-postgresql" (include "agon-arena.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "agon-arena.redisHost" -}}
{{- printf "%s-redis" (include "agon-arena.fullname" .) -}}
{{- end -}}

{{- define "agon-arena.redisUrl" -}}
{{- if .Values.redis.urlOverride -}}
{{- .Values.redis.urlOverride -}}
{{- else -}}
{{- printf "redis://%s:%v" (include "agon-arena.redisHost" .) .Values.redis.service.port -}}
{{- end -}}
{{- end -}}

{{- define "agon-arena.apiImage" -}}
{{- printf "%s:%s" .Values.image.api.repository .Values.image.api.tag -}}
{{- end -}}

{{- define "agon-arena.webImage" -}}
{{- printf "%s:%s" .Values.image.web.repository .Values.image.web.tag -}}
{{- end -}}

{{- define "agon-arena.apiEnv" -}}
- name: PORT
  value: {{ .Values.api.port | quote }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "agon-arena.postgresqlSecretName" . }}
      key: {{ .Values.postgresql.passwordSecretKey }}
- name: DATABASE_URL
  value: {{ printf "postgres://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.postgresql.username (include "agon-arena.postgresqlHost" .) .Values.postgresql.database | quote }}
- name: REDIS_URL
  value: {{ include "agon-arena.redisUrl" . | quote }}
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "agon-arena.apiSecretName" . }}
      key: {{ .Values.api.jwtSecretKey }}
{{- if .Values.api.ed25519PrivateKeySecretKey }}
- name: AGON_ED25519_PRIVATE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agon-arena.apiSecretName" . }}
      key: {{ .Values.api.ed25519PrivateKeySecretKey }}
      optional: true
{{- end }}
{{- if .Values.api.resendApiKeySecretKey }}
- name: RESEND_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agon-arena.apiSecretName" . }}
      key: {{ .Values.api.resendApiKeySecretKey }}
{{- end }}
{{- if .Values.api.resendFromEmailSecretKey }}
- name: RESEND_FROM_EMAIL
  valueFrom:
    secretKeyRef:
      name: {{ include "agon-arena.apiSecretName" . }}
      key: {{ .Values.api.resendFromEmailSecretKey }}
{{- end }}
{{- range $name, $value := .Values.api.env }}
- name: {{ $name }}
  value: {{ $value | quote }}
{{- end }}
{{- end -}}
