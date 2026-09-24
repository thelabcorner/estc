param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('Parse','ExecuteProbe')]
  [string]$Mode,
  [Parameter(Mandatory=$true)]
  [string]$Path,
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'

function Get-Illustrator {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
  } catch {
    if (-not $Launch) {
      throw 'No running Illustrator.Application COM instance. Re-run with --launch only when launching Illustrator is intentional.'
    }
    return New-Object -ComObject Illustrator.Application
  }
}


try {
  $app = Get-Illustrator
  if ($Mode -eq 'Parse') {
    $p = (Resolve-Path -LiteralPath $Path).Path
    $src = Get-Content -LiteralPath $p -Raw -Encoding UTF8

    # Use Illustrator's actual DoJavaScript parser without executing the
    # project body. Evaluating a function expression creates only a temporary
    # function object; the body is parsed completely and never invoked.
    $code = "void function () {`n" + $src + "`n};`n" +
      '"OK|" + app.version + "|" + $.version;'
    try {
      $result = $app.DoJavaScript($code)
      Write-Output ([string]$result)
      if (-not ([string]$result).StartsWith('OK|')) { exit 1 }
      exit 0
    } catch {
      $msg = [string]$_.Exception.Message
      $msg = $msg -replace '[\r\n|]', ' '
      Write-Output ('ERR|||' + $msg)
      exit 1
    }
  }

  $probe = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $result = $app.DoJavaScript($probe)
  Write-Output ([string]$result)
  if (-not ([string]$result).StartsWith('OK|')) { exit 1 }
  exit 0
} catch {
  Write-Error $_
  exit 2
}
