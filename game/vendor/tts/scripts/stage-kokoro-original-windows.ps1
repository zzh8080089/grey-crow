[CmdletBinding()]
param(
  [string]$StageRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$TtsRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot ".."))
$BuildVenv = Join-Path $TtsRoot ".runtime\kokoro-windows-build-venv"
if ([string]::IsNullOrWhiteSpace($StageRoot)) {
  $StageRoot = Join-Path $TtsRoot ".runtime\kokoro-original\stage-windows-x64-minimal"
}
$StageRoot = [System.IO.Path]::GetFullPath($StageRoot)
$ModelRoot = Join-Path $StageRoot "models\kokoro-original"
$StagedPythonRoot = Join-Path $StageRoot "python"
$StagedSitePackages = Join-Path $StagedPythonRoot "Lib\site-packages"
$BuildPython = Join-Path $BuildVenv "Scripts\python.exe"
$StagedPython = Join-Path $StagedPythonRoot "python.exe"

if ($env:RUNNER_OS -and $env:RUNNER_OS -ne "Windows") {
  throw "Windows Kokoro staging must run on a Windows x64 host."
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Windows Kokoro staging requires a 64-bit operating system."
}

Remove-Item -Recurse -Force $BuildVenv -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $StageRoot -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $ModelRoot, (Join-Path $StageRoot "home"), (Join-Path $StageRoot "outputs") | Out-Null

python -m venv $BuildVenv
& $BuildPython -m pip install --disable-pip-version-check --upgrade pip
& $BuildPython -m pip install --disable-pip-version-check --no-deps "kokoro==0.9.4"
& $BuildPython -m pip install --disable-pip-version-check --no-deps --index-url "https://download.pytorch.org/whl/cpu" "torch==2.12.1"
$RuntimeRequirements = @(
  "misaki[zh]==0.9.4",
  "addict>=2,<3",
  "attrs>=25,<27",
  "filelock>=3,<4",
  "fsspec>=2024,<2027",
  "huggingface-hub>=0.27,<2",
  "jinja2>=3,<4",
  "loguru>=0.7,<1",
  "networkx>=3,<4",
  "numpy>=2,<3",
  "proces>=0.1,<1",
  "setuptools>=75,<82",
  "socksio>=1,<2",
  "sympy>=1.13,<2",
  "typing-extensions>=4,<5",
  "transformers>=4,<6"
)
& $BuildPython -m pip install --disable-pip-version-check $RuntimeRequirements
& $BuildPython (Join-Path $ScriptRoot "patch-kokoro-zh-only.py")

$PythonBase = (& $BuildPython -c "import sys; print(sys.base_prefix)").Trim()
$BuildSitePackages = (& $BuildPython -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
& $BuildPython (Join-Path $ScriptRoot "build-kokoro-original-minimal-runtime.py") `
  --python-base $PythonBase `
  --site-packages $BuildSitePackages `
  --platform-label "windows-x64" `
  --python-layout "windows" `
  --python-version "3.12" `
  --output $StagedPythonRoot

Copy-Item (Join-Path $TtsRoot "licenses\upstream\cpython\LICENSE") (Join-Path $StagedPythonRoot "LICENSE")

function Copy-RuntimeLicense {
  param(
    [Parameter(Mandatory = $true)][string]$DistributionPattern,
    [Parameter(Mandatory = $true)][string]$SourceLicense
  )
  $Matches = @(Get-ChildItem -Path $StagedSitePackages -Directory -Filter "$DistributionPattern.dist-info")
  if ($Matches.Count -ne 1) {
    throw "Expected one staged distribution for $DistributionPattern, found $($Matches.Count)."
  }
  $Destination = Join-Path $Matches[0].FullName "licenses\LICENSE"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item $SourceLicense $Destination
}

Copy-RuntimeLicense "jieba-*" (Join-Path $TtsRoot "licenses\upstream\jieba\LICENSE")
Copy-RuntimeLicense "loguru-*" (Join-Path $TtsRoot "licenses\upstream\loguru\LICENSE")
Copy-RuntimeLicense "ordered_set-*" (Join-Path $TtsRoot "licenses\upstream\ordered-set\LICENSE")
Copy-RuntimeLicense "tokenizers-*" (Join-Path $TtsRoot "licenses\upstream\tokenizers\LICENSE")

& $BuildPython (Join-Path $ScriptRoot "download-kokoro-original-model.py") --output $ModelRoot
$KokoroDistribution = @(Get-ChildItem -Path $StagedSitePackages -Directory -Filter "kokoro-*.dist-info")
if ($KokoroDistribution.Count -ne 1) {
  throw "Expected one staged Kokoro distribution."
}
$KokoroLicense = Get-ChildItem -Path $KokoroDistribution[0].FullName -Recurse -File | Where-Object { $_.Name -ieq "LICENSE" } | Select-Object -First 1
if (-not $KokoroLicense) {
  throw "Kokoro distribution license is missing."
}
Copy-Item $KokoroLicense.FullName (Join-Path $ModelRoot "LICENSE")
Copy-Item (Join-Path $TtsRoot "licenses\upstream\kokoro-model\README.md") (Join-Path $ModelRoot "README.md")

$PackageSmoke = Join-Path $StageRoot "kokoro-original-package-smoke.py"
$PackageSmokeOutput = Join-Path $StageRoot "outputs\package-smoke.wav"
Copy-Item (Join-Path $ScriptRoot "kokoro-original-package-smoke.py") $PackageSmoke
$env:HOME = Join-Path $StageRoot "home"
$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:TOKENIZERS_PARALLELISM = "false"
$env:PYTHONNOUSERSITE = "1"
$env:PYTHONUTF8 = "1"
$env:HTTPS_PROXY = "http://127.0.0.1:1"
$env:HTTP_PROXY = "http://127.0.0.1:1"
$env:NO_PROXY = ""
& $StagedPython $PackageSmoke `
  --bundle-root $StageRoot `
  --text "这是灰鸦原版 Kokoro 中文语音包的 Windows 离线封装测试。" `
  --output $PackageSmokeOutput

if (-not (Test-Path $PackageSmokeOutput)) {
  throw "Windows Kokoro package smoke did not create a WAV file."
}
Remove-Item $PackageSmoke, $PackageSmokeOutput
Remove-Item (Join-Path $StageRoot "outputs")

& $StagedPython (Join-Path $ScriptRoot "generate-kokoro-original-compliance.py") --stage-root $StageRoot
$Forbidden = @(Get-ChildItem -Path $StagedPythonRoot -Recurse -Force | Where-Object {
  $_.Name -match "(?i)soundfile|libsndfile|espeak|phonemizer|pyopenjtalk"
})
if ($Forbidden.Count -gt 0) {
  throw "Forbidden TTS dependencies survived Windows staging: $($Forbidden.FullName -join ', ')"
}

$Files = @(Get-ChildItem -Path $StageRoot -Recurse -File)
$Bytes = ($Files | Measure-Object -Property Length -Sum).Sum
Write-Output (@{
  ok = $true
  platform = "windows-x64"
  files = $Files.Count
  bytes = $Bytes
  stageRoot = $StageRoot
} | ConvertTo-Json -Compress)
