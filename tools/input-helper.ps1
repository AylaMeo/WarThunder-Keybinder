# Live input helper (Windows). Prints state CHANGES only, one line each, to stdout:
#   S found|missing         joystick with the given vendor/product id present or not
#   J <mask>                pressed buttons of that joystick as a bitmask (bit 0 = button 1)
#   K <vk,vk,...>           which of the WHITELISTED virtual keys / mouse buttons are down (never anything else)
#   P <centideg>            hat switch (65535 = centred)
#   A x,y,z,r,u,v           analog axes 0..65535, only when one moved noticeably
# It reads joystick state with winmm and key state with GetAsyncKeyState; it installs no hooks and logs nothing.
param(
  [string]$VendorId = '',
  [string]$ProductId = '',
  [string]$Vks = '',
  [int]$ParentPid = 0
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WtkbIn {
  [StructLayout(LayoutKind.Sequential)]
  public struct JOYINFOEX { public int dwSize, dwFlags, dwXpos, dwYpos, dwZpos, dwRpos, dwUpos, dwVpos, dwButtons, dwButtonNumber, dwPOV, dwReserved1, dwReserved2; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct JOYCAPS {
    public ushort wMid, wPid;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
    public uint wXmin, wXmax, wYmin, wYmax, wZmin, wZmax, wNumButtons, wPeriodMin, wPeriodMax;
    public uint wRmin, wRmax, wUmin, wUmax, wVmin, wVmax, wCaps, wMaxAxes, wNumAxes, wMaxButtons;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szRegKey;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szOEMVxD;
  }
  [DllImport("winmm.dll")] public static extern uint joyGetPosEx(uint id, ref JOYINFOEX info);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern uint joyGetDevCaps(IntPtr id, ref JOYCAPS caps, uint size);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
}
"@

$vid = if ($VendorId) { [Convert]::ToInt32($VendorId, 16) } else { -1 }
$pid_ = if ($ProductId) { [Convert]::ToInt32($ProductId, 16) } else { -1 }
$vkList = @()
if ($Vks) { $vkList = $Vks.Split(',') | ForEach-Object { [int]$_ } | Where-Object { $_ -ge 1 -and $_ -le 254 } | Select-Object -First 64 }

function Find-Joystick {
  for ($i = 0; $i -lt 16; $i++) {
    $caps = New-Object WtkbIn+JOYCAPS
    $size = [System.Runtime.InteropServices.Marshal]::SizeOf($caps)
    if ([WtkbIn]::joyGetDevCaps([IntPtr]$i, [ref]$caps, $size) -eq 0 -and $caps.wMid -eq $vid -and $caps.wPid -eq $pid_) { return $i }
  }
  return -1
}

$jid = Find-Joystick
[Console]::Out.WriteLine($(if ($jid -ge 0) { 'S found' } else { 'S missing' })); [Console]::Out.Flush()
$lastMask = -1
$lastPov = -1
$lastAx = @(-9999, -9999, -9999, -9999, -9999, -9999)
$lastKeys = $null
$info = New-Object WtkbIn+JOYINFOEX
$info.dwSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
$info.dwFlags = 0xFF   # JOY_RETURNALLCONTROLS
$tick = 0

while ($true) {
  if ($jid -ge 0) {
    if ([WtkbIn]::joyGetPosEx([uint32]$jid, [ref]$info) -eq 0) {
      if ($info.dwButtons -ne $lastMask) { $lastMask = $info.dwButtons; [Console]::Out.WriteLine("J $lastMask"); [Console]::Out.Flush() }
      # hat switch (the thumb-pad direction keys): centidegrees, 65535 = centred
      $pov = $info.dwPOV -band 0xFFFF
      if ($pov -ne $lastPov) { $lastPov = $pov; [Console]::Out.WriteLine("P $pov"); [Console]::Out.Flush() }
      # analog axes X,Y,Z,R,U,V (0..65535); only report when one moved by more than ~0.6%
      $ax = @($info.dwXpos, $info.dwYpos, $info.dwZpos, $info.dwRpos, $info.dwUpos, $info.dwVpos)
      $moved = $false
      for ($a = 0; $a -lt 6; $a++) { if ([Math]::Abs($ax[$a] - $lastAx[$a]) -gt 400) { $moved = $true } }
      if ($moved) { $lastAx = $ax; [Console]::Out.WriteLine('A ' + ($ax -join ',')); [Console]::Out.Flush() }
    } else { $jid = -1; [Console]::Out.WriteLine('S missing'); [Console]::Out.Flush() }
  }
  if ($vkList.Count -gt 0) {
    $down = ($vkList | Where-Object { ([WtkbIn]::GetAsyncKeyState($_) -band 0x8000) -ne 0 }) -join ','
    if ($down -ne $lastKeys) { $lastKeys = $down; [Console]::Out.WriteLine("K $down"); [Console]::Out.Flush() }
  }
  Start-Sleep -Milliseconds 8
  $tick++
  if ($tick % 125 -eq 0) {                       # about once a second
    if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
    if ($jid -lt 0 -and $vid -ge 0) { $jid = Find-Joystick; if ($jid -ge 0) { $lastMask = -1; $lastPov = -1; $lastAx = @(-9999, -9999, -9999, -9999, -9999, -9999); [Console]::Out.WriteLine('S found'); [Console]::Out.Flush() } }
  }
}
