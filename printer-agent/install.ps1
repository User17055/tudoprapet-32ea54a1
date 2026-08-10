$ErrorActionPreference = "Stop"
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $agentDir "config.json"
if (-not (Test-Path $configPath)) { Copy-Item (Join-Path $agentDir "config.example.json") $configPath }
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$installedPrinters = @(Get-Printer | Sort-Object Name)
$configuredPrinter = $installedPrinters | Where-Object { $_.Name -eq $config.printerName }
if (-not $configuredPrinter) {
  Write-Host ""
  Write-Host "Escolha a impressora de etiquetas:" -ForegroundColor Cyan
  for ($i = 0; $i -lt $installedPrinters.Count; $i++) {
    Write-Host ("[{0}] {1}" -f ($i + 1), $installedPrinters[$i].Name)
  }
  do { $choice = [int](Read-Host "Digite o número da impressora") } while ($choice -lt 1 -or $choice -gt $installedPrinters.Count)
  $config.printerName = $installedPrinters[$choice - 1].Name
  $config | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
}

$bundledNode = Join-Path $agentDir "node.exe"
if (Test-Path $bundledNode) { $node = $bundledNode } else { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { throw "O componente do programa (node.exe) não foi encontrado." }
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "TudoPraPet Impressao.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $node
$shortcut.Arguments = '"' + (Join-Path $agentDir "server.mjs") + '"'
$shortcut.WorkingDirectory = $agentDir
$shortcut.WindowStyle = 7
$shortcut.Description = "Recebe e imprime pedidos TudoPraPet em ZPL"
$shortcut.Save()

$desktop = [Environment]::GetFolderPath("Desktop")
$dashboardShortcutPath = Join-Path $desktop "TudoPraPet Impressao.url"
@"
[InternetShortcut]
URL=http://127.0.0.1:$($config.port)/
"@ | Set-Content $dashboardShortcutPath -Encoding ASCII

# Encerra somente uma versão anterior do agente que esteja usando a porta dele.
$oldListener = Get-NetTCPConnection -LocalPort $config.port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($oldListener) {
  $oldProcess = Get-Process -Id $oldListener.OwningProcess -ErrorAction SilentlyContinue
  if ($oldProcess.ProcessName -eq "node") { Stop-Process -Id $oldProcess.Id -Force }
  else { throw "A porta $($config.port) está sendo usada por outro programa: $($oldProcess.ProcessName)." }
}
Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $agentDir "server.mjs") + '"') -WorkingDirectory $agentDir -WindowStyle Hidden
Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:$($config.port)/"
Write-Host "TudoPraPet Impressão instalado e iniciado."
Write-Host "Configuração: $configPath"
Write-Host "Inicialização automática: $shortcutPath"
Write-Host "Impressora: $($config.printerName)"
Write-Host "Painel local: $dashboardShortcutPath"
Write-Host "Pode fechar esta janela."
