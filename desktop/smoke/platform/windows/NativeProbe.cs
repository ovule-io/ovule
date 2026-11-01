using System;
using System.IO;
using System.Linq;
using System.Diagnostics;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;
using System.Windows.Automation;
using System.Runtime.InteropServices;
public static class NativeProbe {
  public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder name, int maxCount);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
  public static int HitTest(IntPtr hwnd, int x, int y) {
    long packed = ((long)(y & 0xffff) << 16) | (uint)(x & 0xffff);
    return (int)SendMessage(hwnd, 0x0084, IntPtr.Zero, new IntPtr(packed));
  }
  public static void DragNonClient(IntPtr hwnd, int fromX, int fromY, int toX, int toY) {
    SetCursorPos(fromX, fromY);
    System.Threading.Thread.Sleep(100);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(150);
    for (int step = 1; step <= 8; step++) {
      SetCursorPos(fromX + (toX - fromX) * step / 8, fromY + (toY - fromY) * step / 8);
      System.Threading.Thread.Sleep(35);
    }
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(250);
  }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  public delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
  static Process[] Processes(string root) {
    string prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    return Process.GetProcesses().Where(p => {
      try { return p.MainModule.FileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase); }
      catch { return false; }
    }).ToArray();
  }
  static T Wait<T>(Func<T> probe, string description, int seconds) where T : class {
    DateTime end = DateTime.UtcNow.AddSeconds(seconds);
    while (DateTime.UtcNow < end) {
      T value = probe(); if (value != null) return value; Thread.Sleep(100);
    }
    throw new TimeoutException(description);
  }
  static AutomationElement Window(string root, bool devtools) {
    var pids = new HashSet<int>(Processes(root).Select(p => p.Id));
    return AutomationElement.RootElement.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window))
      .Cast<AutomationElement>().FirstOrDefault(e => pids.Contains(e.Current.ProcessId) && e.Current.Name.Contains("DevTools") == devtools);
  }
  static IntPtr AppHandle(string root) {
    var window = Wait(() => Window(root, false), "Application window did not become ready", 30);
    return new IntPtr(window.Current.NativeWindowHandle);
  }
  static RECT Bounds(IntPtr hwnd) {
    RECT r; Require(GetWindowRect(hwnd, out r), "Cannot read window bounds"); return r;
  }
  static void Foreground(IntPtr hwnd) {
    ShowWindow(hwnd, 9); SetForegroundWindow(hwnd); Thread.Sleep(400);
  }
  static void OwnedPoint(string root, int x, int y) {
    uint pid; var window = GetAncestor(WindowFromPoint(new POINT { X=x,Y=y }), 2);
    GetWindowThreadProcessId(window, out pid);
    Require(Processes(root).Any(p => p.Id == pid), "Test target is occluded by another application");
  }
  static Bitmap Capture(IntPtr hwnd, string file) {
    var r=Bounds(hwnd); int w=r.Right-r.Left,h=r.Bottom-r.Top;
    Require(w>=100 && h>=100, "Invalid window bounds");
    var image=new Bitmap(w,h);
    using(var graphics=Graphics.FromImage(image)) graphics.CopyFromScreen(r.Left,r.Top,0,0,image.Size,CopyPixelOperation.SourceCopy);
    image.Save(file,ImageFormat.Png); return image;
  }
  static bool Overlay(Color c) {
    bool blue=c.R>=90 && c.R<=165 && c.G>=140 && c.G<=210 && c.B>=185 && c.B<=245 && c.B>c.R+35;
    bool green=c.R>=120 && c.R<=195 && c.G>=170 && c.G<=230 && c.B>=90 && c.B<=180 && c.G>c.B+25;
    bool orange=c.R>=220 && c.G>=130 && c.G<=220 && c.B>=65 && c.B<=180;
    return blue || green || orange;
  }
  static int OverlayPixels(Bitmap image, Bitmap before, out int changed) {
    int count=0; changed=0;
    for(int y=0;y<image.Height;y+=3) for(int x=0;x<image.Width;x+=3) {
      Color c=image.GetPixel(x,y); if(!Overlay(c)) continue; count++;
      if(before!=null) { Color b=before.GetPixel(x,y); if(Math.Abs(c.R-b.R)+Math.Abs(c.G-b.G)+Math.Abs(c.B-b.B)>=45) changed++; }
    }
    return count;
  }
  static AutomationElement Named(AutomationElement root,string name) {
    return root.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,name));
  }
  static void Invoke(AutomationElement element) { ((InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern)).Invoke(); }
  static void InspectMenu(string root,bool fallback) {
    AutomationElement item=null;
    DateTime end=DateTime.UtcNow.AddSeconds(15);
    while(item==null && DateTime.UtcNow<end) {
      var pids=new HashSet<int>(Processes(root).Select(p=>p.Id));
      item=AutomationElement.RootElement.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,"Inspect element"))
        .Cast<AutomationElement>().FirstOrDefault(e=>pids.Contains(e.Current.ProcessId));
      if(item==null) Thread.Sleep(100);
    }
    if(item!=null) Invoke(item);
    else if(fallback) {
      uint pid; GetWindowThreadProcessId(GetForegroundWindow(),out pid);
      Require(Processes(root).Any(p=>p.Id==pid),"Cannot send menu keys to an unrelated window");
      System.Windows.Forms.SendKeys.SendWait("{END}"); Thread.Sleep(150); System.Windows.Forms.SendKeys.SendWait("{ENTER}");
      Console.WriteLine("explorer_inspect_menu_selection=keyboard-fallback");
    } else throw new InvalidOperationException("Root context menu did not expose Inspect element without remote debugging");
  }
  static void RootInspect(string root,string artifacts) {
    var hwnd=AppHandle(root);
    Foreground(hwnd);
    Require(SetWindowPos(hwnd,new IntPtr(-1),80,80,1100,700,0x0040),"Cannot position root App window"); Thread.Sleep(500);
    var r=Bounds(hwnd);int w=r.Right-r.Left,h=r.Bottom-r.Top,x=r.Left+(int)(w*.12),y=r.Top+(int)(h*.55);
    OwnedPoint(root,x,y);
    using(var before=Capture(hwnd,Path.Combine(artifacts,"root-before-picker.png"))) {
      SetCursorPos(x,y);mouse_event(0x0008,0,0,0,UIntPtr.Zero);mouse_event(0x0010,0,0,0,UIntPtr.Zero);
      InspectMenu(root,false);
      var tools=Wait(()=>Window(root,true),"Inspect element did not create DevTools",60);
      var picker=Wait(()=>Named(tools,"Select an element in the page to inspect it"),"DevTools picker missing in UIAutomation",60);
      Foreground(hwnd);Invoke(picker);Thread.Sleep(750);Foreground(hwnd);
      SetCursorPos(r.Left+(int)(w*.25),r.Top+(int)(h*.30));Thread.Sleep(250);SetCursorPos(x,y);Thread.Sleep(1500);
      using(var after=Capture(hwnd,Path.Combine(artifacts,"root-after-picker.png"))) {
        int changed;int pixels=OverlayPixels(after,before,out changed);
        Require(pixels>=250 && changed>=150,"Root picker overlay was not visibly painted: overlay="+pixels+" new="+changed);
        Console.WriteLine("root_inspect_element=ok launch_mode=production overlay_pixels="+pixels+" new_overlay_pixels="+changed);
      }
    }
  }
  static void ExplorerCapture(string root,string file) {
    var hwnd=AppHandle(root);Foreground(hwnd);var r=Bounds(hwnd);int w=r.Right-r.Left,h=r.Bottom-r.Top;
    SetCursorPos(r.Left+(int)(w*.55),r.Top+(int)(h*.30));Thread.Sleep(250);
    int x=r.Left+(int)(w*.84),y=r.Top+(int)(h*.48);OwnedPoint(root,x,y);SetCursorPos(x,y);Thread.Sleep(1500);
    using(var image=Capture(hwnd,file)) { int unused;int pixels=OverlayPixels(image,null,out unused);Console.WriteLine("{\"overlayPixels\":"+pixels+"}"); }
  }
  static void ContextMenu(string root,int x,int y) {
    var pids=new HashSet<int>(Processes(root).Select(p=>p.Id));var menus=new List<RECT>();
    EnumWindows((hwnd,parameter)=> {
      uint pid;GetWindowThreadProcessId(hwnd,out pid);var name=new System.Text.StringBuilder(256);GetClassName(hwnd,name,256);
      if(IsWindowVisible(hwnd) && pids.Contains((int)pid) && name.ToString()=="Chrome_WidgetWin_0") {
        var r=Bounds(hwnd);int w=r.Right-r.Left,h=r.Bottom-r.Top;if(w>0&&h>0&&w<640&&h<640)menus.Add(r);
      }return true;
    },IntPtr.Zero);
    Require(menus.Count>0,"Explorer context menu native window was not found");
    Func<RECT,int> distance=r=>Math.Max(Math.Max(r.Left-x,x-r.Right),Math.Max(r.Top-y,y-r.Bottom));
    int closest=menus.Min(distance);Require(closest<=32,"Context menu is offset from click by "+closest+" pixels");
    Console.WriteLine("explorer_context_menu_position=ok");
  }
  static void Focus(string root,int pid) {
    var p=Process.GetProcessById(pid);
    Require(String.Equals(p.MainModule.FileName,Path.Combine(Path.GetFullPath(root),"ovule.exe"),StringComparison.OrdinalIgnoreCase),"Refusing to focus an unrelated process");
    var hwnd=p.MainWindowHandle;Require(hwnd!=IntPtr.Zero,"Test Host has no native window");
    uint unused;uint current=GetCurrentThreadId(),foreground=GetWindowThreadProcessId(GetForegroundWindow(),out unused),target=GetWindowThreadProcessId(hwnd,out unused);
    var attached=new List<uint>();
    try { foreach(var thread in new[]{foreground,target}.Distinct()) if(thread!=0 && thread!=current && AttachThreadInput(current,thread,true))attached.Add(thread);
      ShowWindow(hwnd,9);BringWindowToTop(hwnd);SetForegroundWindow(hwnd);
    } finally { foreach(var thread in attached)AttachThreadInput(current,thread,false); }
    GetWindowThreadProcessId(GetForegroundWindow(),out unused);Require(unused==pid,"Test Host did not become foreground");
  }
  static void NativeUi(string root,string artifacts,string brand) {
    var hwnd=AppHandle(root);var r=Bounds(hwnd);
    Require(r.Right-r.Left>=960 && r.Bottom-r.Top>=640,"Application window is unexpectedly small");
    var required=new[]{brand,"Prepare your Agent capabilities","Agents","Continue"};
    Wait(()=> {
      var names=AutomationElement.FromHandle(hwnd).FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>().Select(e=>e.Current.Name).ToArray();
      return required.All(n=>names.Contains(n)) ? names : null;
    },"Onboarding accessibility tree is incomplete",30);
    hwnd=AppHandle(root);uint owner;GetWindowThreadProcessId(hwnd,out owner);
    Require(Processes(root).Any(p=>p.Id==owner),"Native window changed ownership");
    Require(SetWindowPos(hwnd,new IntPtr(-1),120,100,1100,700,0x0040),"Cannot position native window");Thread.Sleep(500);
    r=Bounds(hwnd);int midX=(r.Left+r.Right)/2,midY=(r.Top+r.Bottom)/2;
    var tests=new[]{new[]{r.Left,midY,10},new[]{r.Right-1,midY,11},new[]{midX,r.Top,12},new[]{midX,r.Bottom-1,15},new[]{r.Left,r.Top,13},new[]{r.Right-1,r.Top,14},new[]{r.Left,r.Bottom-1,16},new[]{r.Right-1,r.Bottom-1,17}};
    foreach(var test in tests)Require(HitTest(hwnd,test[0],test[1])==test[2],"Frameless resize hit-test failed: expected="+test[2]);
    foreach(string edge in new[]{"right","bottom","left","top"}) {
      bool changed=false;
      for(int attempt=0;attempt<3 && !changed;attempt++) {
        Require(SetWindowPos(hwnd,new IntPtr(-1),120,100,1100,700,0x0040),"Cannot reset native window");Foreground(hwnd);Thread.Sleep(250+attempt*100);
        var before=Bounds(hwnd);int x=(before.Left+before.Right)/2,y=(before.Top+before.Bottom)/2,toX=x,toY=y,hit=0,distance=32+attempt*8;
        switch(edge) {
          case "right": x=before.Right-1-attempt;toX=x+distance;hit=11;break;
          case "bottom": y=before.Bottom-1-attempt;toY=y+distance;hit=15;break;
          case "left": x=before.Left+attempt;toX=x-distance;hit=10;break;
          case "top": y=before.Top+attempt;toY=y-distance;hit=12;break;
        }
        if(HitTest(hwnd,x,y)!=hit)continue;
        OwnedPoint(root,x,y);DragNonClient(hwnd,x,y,toX,toY);var after=Bounds(hwnd);
        int bw=before.Right-before.Left,bh=before.Bottom-before.Top,aw=after.Right-after.Left,ah=after.Bottom-after.Top;
        changed=edge=="right" ? aw>bw : edge=="bottom" ? ah>bh : edge=="left" ? after.Left<before.Left && aw>bw : after.Top<before.Top && ah>bh;
      }
      Require(changed,"Mouse resize failed on "+edge+" after three attempts");
    }
    r=Bounds(hwnd);int width=r.Right-r.Left+48,height=r.Bottom-r.Top+36;
    Require(SetWindowPos(hwnd,IntPtr.Zero,r.Left,r.Top,width,height,0x0014),"Window resize failed");Thread.Sleep(500);r=Bounds(hwnd);
    Require(r.Right-r.Left==width && r.Bottom-r.Top==height,"Window did not apply resize");
    Require((GetWindowLongPtr(hwnd,-16).ToInt64()&0x00040000)!=0,"Window is missing WS_THICKFRAME");
    int corner;int result=DwmGetWindowAttribute(hwnd,33,out corner,4);Require(result!=0 || corner==2 || corner==3,"Rounded-corner preference missing");
    RECT client;Require(GetClientRect(hwnd,out client),"Cannot read client bounds");var origin=new POINT();Require(ClientToScreen(hwnd,ref origin),"Cannot map client origin");
    Require(origin.Y-r.Top<=12,"Client area leaves room for a system title bar");Foreground(hwnd);Thread.Sleep(2000);
    using(var image=Capture(hwnd,Environment.GetEnvironmentVariable("OVULE_NATIVE_SCREENSHOT") ?? Path.Combine(artifacts,"native-window.png"))) {
      int sampled=0,nonBlack=0,titlebar=0;var colors=new HashSet<int>();
      for(int y=4;y<Math.Min(40,height);y+=4)for(int x=8;x<width;x+=12) { var c=image.GetPixel(x,y);if(c.R+c.G+c.B>24)titlebar++; }
      for(int y=56;y<height;y+=24)for(int x=12;x<width;x+=24) { var c=image.GetPixel(x,y);colors.Add(c.ToArgb());if(c.R+c.G+c.B>24)nonBlack++;sampled++; }
      Require(nonBlack>=Math.Max(20,(int)(sampled*.05)) && colors.Count>=4,"Native window capture looks blank");Require(titlebar>=20,"Custom titlebar not visible");
      Console.WriteLine("native_ui_geometry=ok resize_edges=8 mouse_resize=4 rounded_corner="+corner+" pixels_non_black="+nonBlack+" colors="+colors.Count+" uia_content=true");
    }
  }
  static void DismissExternalProtocol(string root) {
    var dialog=Wait(()=>{
      var pids=new HashSet<int>(Processes(root).Select(p=>p.Id));
      var title=new PropertyCondition(AutomationElement.NameProperty,"Open an external application?");
      return AutomationElement.RootElement.FindAll(TreeScope.Children,Condition.TrueCondition)
        .Cast<AutomationElement>().Where(e=>pids.Contains(e.Current.ProcessId))
        .FirstOrDefault(e=>e.Current.Name=="Open an external application?" ||
          e.FindFirst(TreeScope.Descendants,title)!=null);
    },"External protocol confirmation did not appear",30);
    var cancel=dialog.FindFirst(TreeScope.Descendants,new AndCondition(
      new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),
      new PropertyCondition(AutomationElement.NameProperty,"Cancel")));
    Require(cancel!=null,"External protocol dialog has no Cancel button");
    ((InvokePattern)cancel.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
    Console.WriteLine("external_protocol_confirmation=dismissed");
  }
  static void OwnedTree(string root) {
    var pids=new HashSet<int>(Processes(root).Select(p=>p.Id));
    foreach(var window in AutomationElement.RootElement.FindAll(TreeScope.Children,Condition.TrueCondition)
      .Cast<AutomationElement>().Where(e=>pids.Contains(e.Current.ProcessId))) {
      Console.WriteLine("window="+window.Current.Name+" pid="+window.Current.ProcessId);
      foreach(var node in window.FindAll(TreeScope.Descendants,Condition.TrueCondition).Cast<AutomationElement>().Take(100)) {
        if(!String.IsNullOrEmpty(node.Current.Name)) Console.WriteLine(node.Current.ControlType.ProgrammaticName+"="+node.Current.Name);
      }
    }
  }
  [STAThread] public static int Main(string[] args) {
    try {
      SetProcessDPIAware();
      string command=args[0],root=args[1];
      switch(command) {
        case "processes": Console.WriteLine(String.Join(",",Processes(root).Select(p=>p.Id)));break;
        case "stop": foreach(var p in Processes(root)) { try {p.Kill();p.WaitForExit(5000);}catch(InvalidOperationException){} }break;
        case "focus": Focus(root,int.Parse(args[2]));break;
        case "foreground": Foreground(AppHandle(root));break;
        case "context-menu": ContextMenu(root,int.Parse(args[2]),int.Parse(args[3]));break;
        case "inspect-menu": InspectMenu(root,true);break;
        case "explorer-capture": ExplorerCapture(root,args[2]);break;
        case "root-inspect": RootInspect(root,args[2]);break;
        case "native-ui": NativeUi(root,args[2],args[3]);break;
        case "external-protocol-dismiss": DismissExternalProtocol(root);break;
        case "owned-tree": OwnedTree(root);break;
        default: throw new ArgumentException("Unknown probe: "+command);
      }
      return 0;
    } catch(Exception error) { Console.Error.WriteLine(error);return 1; }
  }
}
