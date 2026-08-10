param([Parameter(Mandatory=$true)][string]$PrinterName,[Parameter(Mandatory=$true)][string]$FilePath)
$source = @"
using System; using System.IO; using System.Runtime.InteropServices;
public static class RawPrinter {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
 [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Ansi)] static extern bool StartDocPrinter(IntPtr h,int l,[In] DOCINFOA d);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,byte[] b,int c,out int w);
 public static void Send(string printer,string path) { byte[] b=File.ReadAllBytes(path); IntPtr h; if(!OpenPrinter(printer,out h,IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); try { var d=new DOCINFOA{pDocName="TudoPraPet ZPL",pDataType="RAW"}; if(!StartDocPrinter(h,1,d)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); try { StartPagePrinter(h); int w; if(!WritePrinter(h,b,b.Length,out w)||w!=b.Length) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); EndPagePrinter(h); } finally { EndDocPrinter(h); } } finally { ClosePrinter(h); } }
}
"@
Add-Type -TypeDefinition $source
[RawPrinter]::Send($PrinterName,$FilePath)
