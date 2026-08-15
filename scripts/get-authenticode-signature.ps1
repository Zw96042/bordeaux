param(
    [Parameter(Mandatory = $true)]
    [string] $Artifact
)

$ErrorActionPreference = "Stop"
$signature = Get-AuthenticodeSignature -LiteralPath $Artifact
[pscustomobject]@{
    Status = [string] $signature.Status
    StatusMessage = [string] $signature.StatusMessage
    SignerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
    SignerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
    SignerNotAfter = if ($signature.SignerCertificate) { $signature.SignerCertificate.NotAfter.ToUniversalTime().ToString("O") } else { $null }
    TimestampSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
    TimestampThumbprint = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Thumbprint } else { $null }
    TimestampNotAfter = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.NotAfter.ToUniversalTime().ToString("O") } else { $null }
} | ConvertTo-Json -Compress
