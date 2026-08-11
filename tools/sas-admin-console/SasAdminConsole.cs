using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

class SasAdminConsole : Form {
  TextBox root, share, issueDetail, codexRequest, codexResponse;
  RichTextBox log;
  ComboBox channel;
  Button refresh, clean, services, update, backup, repair, turn, settings, copyDiag, validate, askCodex;
  ProgressBar progress;
  Label status, installedCard, availableCard, serviceCard, healthCard, problemCount;
  ListView issuesView;
  TabControl tabs;
  TabPage activityTab, issuesTab, codexTab;
  List<Issue> issues=new List<Issue>();
  string activeVersion="desconocida", installedVersion="desconocida", availableVersion="ninguna", serviceState="Desconocido", lastCodexFile="";
  string[] oldTasks={"SAS Support Server Production","SAS Support Platform Update","SAS Support Client Agent","SAS Support Server"};
  string[] serviceNames={"SAS Support Server","SAS Support TURN","SAS Support Client Agent"};

  SasAdminConsole(){
    Text="SAS Administrador"; Width=1120; Height=760; MinimumSize=new Size(930,620); StartPosition=FormStartPosition.CenterScreen;
    BackColor=Color.FromArgb(28,32,36); ForeColor=Color.FromArgb(242,244,243); Font=new Font("Segoe UI",9F);
    var header=new Panel{Dock=DockStyle.Top,Height=54,BackColor=Color.FromArgb(43,50,48)};
    header.Controls.Add(new Label{Text="SAS Administrador",Left=16,Top=8,AutoSize=true,Font=new Font("Segoe UI Semibold",16F),ForeColor=Color.FromArgb(225,236,230)});
    header.Controls.Add(new Label{Text="Mantenimiento, recuperación y diagnóstico asistido",Left=18,Top=34,AutoSize=true,ForeColor=Color.FromArgb(174,190,181)});
    installedCard=AddCard(header,"Instalada: —",420); availableCard=AddCard(header,"Disponible: —",575);
    serviceCard=AddCard(header,"Servicio: —",730); healthCard=AddCard(header,"Salud: —",885);

    var configBar=new FlowLayoutPanel{Dock=DockStyle.Top,Height=40,Padding=new Padding(10,7,8,4),BackColor=Color.FromArgb(50,57,55),WrapContents=false};
    configBar.Controls.Add(AddCaption("Instalación:")); root=new TextBox{Width=220,Text=@"C:\SAS\Server"}; configBar.Controls.Add(root);
    configBar.Controls.Add(AddCaption("Actualizaciones:")); share=new TextBox{Width=220,Text=@"\\SERVER\SASUpdates$"}; configBar.Controls.Add(share);
    channel=new ComboBox{Width=90,DropDownStyle=ComboBoxStyle.DropDownList};
    channel.Items.AddRange(new object[]{"stable","testing","client"}); channel.SelectedIndex=0; configBar.Controls.Add(channel);

    var actions=new FlowLayoutPanel{Dock=DockStyle.Top,Height=76,Padding=new Padding(9,6,8,4),BackColor=Color.FromArgb(36,42,40),WrapContents=true,AutoScroll=false};
    refresh=AddButton(actions,"Actualizar estado",124,(s,e)=>SafeAction("Actualizar estado",RefreshState));
    update=AddPrimaryButton(actions,"Actualizar versión",126,(s,e)=>SafeAction("Actualizar versión",UpdateVersion));
    services=AddButton(actions,"Reiniciar servicios",126,(s,e)=>SafeAction("Reiniciar servicios",RestartServices));
    repair=AddButton(actions,"Reparar instalación",128,(s,e)=>SafeAction("Reparar instalación",Repair));
    turn=AddButton(actions,"Configurar TURN",118,(s,e)=>SafeAction("Configurar TURN",ConfigureTurn));
    settings=AddPrimaryButton(actions,"Configuración",120,(s,e)=>SafeAction("Configuración del servidor",OpenServerConfiguration));actions.SetFlowBreak(settings,true);
    backup=AddButton(actions,"Crear respaldo",108,(s,e)=>SafeAction("Crear respaldo",Backup));
    validate=AddButton(actions,"Validar sistema",112,(s,e)=>SafeAction("Validar sistema",ValidateFlow));
    clean=AddButton(actions,"Limpiar tareas",105,(s,e)=>SafeAction("Limpiar tareas",CleanTasks));
    copyDiag=AddButton(actions,"Copiar diagnóstico",124,(s,e)=>SafeAction("Copiar diagnóstico",CopyDiagnostic));
    askCodex=AddPrimaryButton(actions,"Consultar a Codex",125,(s,e)=>SafeAction("Preparar consulta Codex",PrepareCodexRequest));

    tabs=new TabControl{Dock=DockStyle.Fill,Padding=new Point(16,6)};
    activityTab=new TabPage("Actividad"); issuesTab=new TabPage("Problemas y soluciones"); codexTab=new TabPage("Codex");
    BuildActivityTab(); BuildIssuesTab(); BuildCodexTab(); tabs.TabPages.Add(activityTab);tabs.TabPages.Add(issuesTab);tabs.TabPages.Add(codexTab);
    var bottom=new Panel{Dock=DockStyle.Bottom,Height=38,BackColor=Color.FromArgb(43,50,48)};
    progress=new ProgressBar{Left=10,Top=10,Width=260,Height=18,Style=ProgressBarStyle.Continuous};
    status=new Label{Left=282,Top=10,Width=790,ForeColor=Color.FromArgb(225,236,230),Text="Listo"};
    bottom.Controls.Add(progress); bottom.Controls.Add(status);
    Controls.Add(tabs); Controls.Add(bottom); Controls.Add(actions); Controls.Add(configBar); Controls.Add(header);
    Shown+=(s,e)=>SafeAction("Inicio",RefreshState);
  }

  Label AddCard(Control parent,string text,int left){var card=new Label{Text=text,Left=left,Top=12,Width=145,Height=30,TextAlign=ContentAlignment.MiddleCenter,BackColor=Color.FromArgb(56,66,62),ForeColor=Color.FromArgb(226,236,230),Font=new Font("Segoe UI Semibold",9F)};parent.Controls.Add(card);return card;}
  Label AddCaption(string text){return new Label{Text=text,AutoSize=true,Margin=new Padding(8,4,2,0),ForeColor=Color.FromArgb(220,228,224)};}
  Button AddButton(Control parent,string text,int width,EventHandler handler){var b=new Button{Text=text,Width=width,Height=29,FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(67,76,72),ForeColor=Color.White,Margin=new Padding(3,0,3,0)};b.FlatAppearance.BorderColor=Color.FromArgb(92,104,98);b.Click+=handler;parent.Controls.Add(b);return b;}
  Button AddPrimaryButton(Control parent,string text,int width,EventHandler handler){var b=AddButton(parent,text,width,handler);b.BackColor=Color.FromArgb(54,112,82);b.FlatAppearance.BorderColor=Color.FromArgb(89,145,112);return b;}
  void BuildActivityTab(){activityTab.BackColor=Color.FromArgb(28,32,36);log=new RichTextBox{Dock=DockStyle.Fill,ReadOnly=true,Font=new Font("Consolas",10F),BackColor=Color.FromArgb(22,25,27),ForeColor=Color.FromArgb(232,235,233),BorderStyle=BorderStyle.None,DetectUrls=false};activityTab.Controls.Add(log);}
  void BuildIssuesTab(){
    issuesTab.BackColor=Color.FromArgb(28,32,36);
    var split=new SplitContainer{Dock=DockStyle.Fill,Orientation=Orientation.Horizontal,SplitterDistance=280,BackColor=Color.FromArgb(28,32,36)};
    issuesView=new ListView{Dock=DockStyle.Fill,View=View.Details,FullRowSelect=true,HideSelection=false,BackColor=Color.FromArgb(22,25,27),ForeColor=Color.FromArgb(235,238,236),BorderStyle=BorderStyle.None};
    issuesView.Columns.Add("Nivel",80);issuesView.Columns.Add("Problema",360);issuesView.Columns.Add("Acción recomendada",560);issuesView.SelectedIndexChanged+=(s,e)=>ShowSelectedIssue();split.Panel1.Controls.Add(issuesView);
    var panel=new Panel{Dock=DockStyle.Fill,Padding=new Padding(8),BackColor=Color.FromArgb(33,38,40)};
    problemCount=new Label{Dock=DockStyle.Top,Height=28,Text="Sin problemas detectados",ForeColor=Color.FromArgb(184,203,193),Font=new Font("Segoe UI Semibold",10F)};
    issueDetail=new TextBox{Dock=DockStyle.Fill,Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,BackColor=Color.FromArgb(24,28,29),ForeColor=Color.FromArgb(235,238,236),Font=new Font("Consolas",9.5F)};
    var copy=new Button{Dock=DockStyle.Bottom,Height=30,Text="Copiar problema seleccionado",FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(67,76,72),ForeColor=Color.White};copy.Click+=(s,e)=>SafeAction("Copiar problema",CopySelectedIssue);
    panel.Controls.Add(issueDetail);panel.Controls.Add(copy);panel.Controls.Add(problemCount);split.Panel2.Controls.Add(panel);issuesTab.Controls.Add(split);
  }
  void BuildCodexTab(){
    codexTab.BackColor=Color.FromArgb(28,32,36);
    var info=new Label{Dock=DockStyle.Top,Height=48,Padding=new Padding(10,7,10,4),Text="Canal seguro con Codex: prepara el contexto técnico, oculta secretos y guarda el expediente. Copia la consulta, abre Codex y pega aquí la respuesta para conservarla.",ForeColor=Color.FromArgb(211,224,217)};
    var buttons=new FlowLayoutPanel{Dock=DockStyle.Top,Height=40,Padding=new Padding(8,5,8,3),BackColor=Color.FromArgb(38,44,42),WrapContents=false};
    AddPrimaryButton(buttons,"Preparar consulta",130,(s,e)=>SafeAction("Preparar consulta",PrepareCodexRequest));AddButton(buttons,"Copiar para Codex",130,(s,e)=>SafeAction("Copiar consulta",CopyCodexRequest));AddButton(buttons,"Abrir Codex",105,(s,e)=>SafeAction("Abrir Codex",OpenCodex));AddButton(buttons,"Guardar respuesta",130,(s,e)=>SafeAction("Guardar respuesta",SaveCodexResponse));
    var split=new SplitContainer{Dock=DockStyle.Fill,Orientation=Orientation.Horizontal,SplitterDistance=310,BackColor=Color.FromArgb(28,32,36)};
    codexRequest=new TextBox{Dock=DockStyle.Fill,Multiline=true,ScrollBars=ScrollBars.Both,BackColor=Color.FromArgb(22,25,27),ForeColor=Color.FromArgb(235,238,236),Font=new Font("Consolas",9.5F),WordWrap=false};
    codexResponse=new TextBox{Dock=DockStyle.Fill,Multiline=true,ScrollBars=ScrollBars.Both,BackColor=Color.FromArgb(27,31,33),ForeColor=Color.FromArgb(225,232,228),Font=new Font("Consolas",9.5F)};
    split.Panel1.Controls.Add(codexRequest);split.Panel1.Controls.Add(new Label{Dock=DockStyle.Top,Height=24,Text=" Consulta preparada para Codex",ForeColor=Color.FromArgb(177,199,187),BackColor=Color.FromArgb(38,44,42)});
    split.Panel2.Controls.Add(codexResponse);split.Panel2.Controls.Add(new Label{Dock=DockStyle.Top,Height=24,Text=" Respuesta de Codex / notas de resolución",ForeColor=Color.FromArgb(177,199,187),BackColor=Color.FromArgb(38,44,42)});
    codexTab.Controls.Add(split);codexTab.Controls.Add(buttons);codexTab.Controls.Add(info);
  }

  void SafeAction(string action,Action operation){try{operation();}catch(Exception ex){ReportException(action,ex);}}
  void ReportException(string action,Exception ex){SetProgress(0,action+" falló");WriteError(action+" falló: "+FriendlyError(ex.Message));AddIssue("UNEXPECTED_ERROR",action+" no pudo completarse",FullException(ex),"Revisa la acción sugerida, copia el diagnóstico y consulta a Codex si persiste.","Error");tabs.SelectedTab=issuesTab;}
  void SetProgress(int value,string text){progress.Value=Math.Max(0,Math.Min(100,value));status.Text=text;Application.DoEvents();}
  void Write(string value){WriteColored(value,Color.FromArgb(225,230,227));}
  void WriteSuccess(string value){WriteColored("CORRECTO · "+value,Color.FromArgb(115,209,154));}
  void WriteWarning(string value){WriteColored("AVISO · "+value,Color.FromArgb(238,190,92));}
  void WriteError(string value){WriteColored("ERROR · "+value,Color.FromArgb(244,119,119));}
  void WriteColored(string value,Color color){value=NormalizeEncoding(value);if(String.IsNullOrWhiteSpace(value))return;var lines=value.Split(new char[]{(char)13,(char)10},StringSplitOptions.RemoveEmptyEntries);status.Text=lines.LastOrDefault()??value;foreach(var line in lines){log.SelectionStart=log.TextLength;log.SelectionColor=Color.FromArgb(135,151,143);log.AppendText("["+DateTime.Now.ToString("HH:mm:ss")+"] ");log.SelectionColor=color;log.AppendText(line.Trim()+Environment.NewLine);}log.SelectionColor=log.ForeColor;log.ScrollToCaret();}
  static string PackageVersion(string file){if(!File.Exists(file))return null;var m=Regex.Match(File.ReadAllText(file),@"""version""\s*:\s*""([^""]+)""");return m.Success?m.Groups[1].Value:null;}
  static Version ParseVersion(string value){Version v;return Version.TryParse(value,out v)?v:new Version(0,0,0,0);}
  static string VersionFromZip(string zip){return Path.GetFileNameWithoutExtension(zip).Replace("sas-update-","");}
  string LatestPackage(){try{var dir=Path.Combine(share.Text,channel.Text);if(!Directory.Exists(dir))return null;return Directory.GetFiles(dir,"sas-update-*.zip").OrderByDescending(x=>ParseVersion(VersionFromZip(x))).FirstOrDefault();}catch(Exception ex){AddIssue("UPDATE_CHANNEL","No se pudo leer el canal de actualizaciones",ex.Message,"Comprueba que SERVER esté disponible y que esta cuenta tenga permiso de lectura.","Error");return null;}}
  static string HashFile(string path){using(var sha=SHA256.Create())using(var stream=File.OpenRead(path)){return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","");}}
  bool ValidatePackage(string zip,out string error){
    error=null;var manifest=Path.Combine(Path.GetDirectoryName(zip),"manifest.json");
    try{
      if(!File.Exists(manifest)){error="Falta manifest.json en el canal.";return false;}
      var json=File.ReadAllText(manifest);var version=Regex.Match(json,@"""version""\s*:\s*""([^""]+)""");var hash=Regex.Match(json,@"""sha256""\s*:\s*""([A-Fa-f0-9]{64})""");
      if(!version.Success||version.Groups[1].Value!=VersionFromZip(zip)){error="La versión del manifiesto no coincide con el ZIP.";return false;}
      if(!hash.Success||!HashFile(zip).Equals(hash.Groups[1].Value,StringComparison.OrdinalIgnoreCase)){error="SHA-256 del paquete incorrecto.";return false;}
      return true;
    }catch(Exception ex){error=FriendlyError(ex.Message);return false;}
  }

  void RefreshState(){
    SetProgress(5,"Consultando instalación...");ClearIssues();Write("──────── Estado de SAS ────────");
    installedVersion=PackageVersion(Path.Combine(root.Text,"package.json"))??"desconocida";Write("Versión instalada: "+installedVersion);
    var zip=LatestPackage();availableVersion=zip==null?"ninguna":VersionFromZip(zip);Write("Versión disponible: "+availableVersion+" | Canal: "+channel.Text);
    activeVersion="sin respuesta";bool healthOk=false;
    try{using(var wc=new WebClient()){wc.Headers[HttpRequestHeader.CacheControl]="no-cache";var health=wc.DownloadString("http://127.0.0.1/health");var m=Regex.Match(health,@"""version""\s*:\s*""([^""]+)""");activeVersion=m.Success?m.Groups[1].Value:"sin versión";healthOk=true;WriteSuccess("/health responde con versión "+activeVersion);}}
    catch(Exception ex){WriteError("/health no responde: "+FriendlyError(ex.Message));AddIssue("HEALTH_UNAVAILABLE","La aplicación web no responde",ex.Message,"Reinicia el servicio. Si continúa, abre el problema y copia la consulta para Codex.","Error");}

    ServiceController serverService=null;
    foreach(var n in serviceNames){
      try{var x=ServiceController.GetServices().FirstOrDefault(v=>v.ServiceName.Equals(n,StringComparison.OrdinalIgnoreCase));if(n=="SAS Support Server")serverService=x;Write((x==null?"AVISO · ":"CORRECTO · ")+"Servicio "+n+": "+(x==null?"NO INSTALADO":TranslateServiceStatus(x.Status)));if(n=="SAS Support Server"&&x==null)AddIssue("SERVICE_MISSING","El servicio principal no está instalado","Windows no encontró el servicio SAS Support Server.","Usa Reparar instalación; conserva datos, configuración y certificados.","Error");}
      catch(Exception ex){WriteError("Servicio "+n+": "+FriendlyError(ex.Message));AddIssue("SERVICE_QUERY","No se pudo consultar "+n,ex.Message,"Ejecuta SAS Administrador como administrador.","Error");}
    }
    serviceState=serverService==null?"No instalado":TranslateServiceStatus(serverService.Status);
    InspectTurnIpMonitor();
    if(serverService!=null&&serverService.Status!=ServiceControllerStatus.Running)AddIssue("SERVICE_STOPPED","El servicio principal está detenido","Estado de Windows: "+serverService.Status,"Pulsa Reiniciar servicios. Si vuelve a detenerse, revisa el error reciente y consulta a Codex.","Error");

    var listeners=IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
    foreach(int port in new[]{80,443}){bool listening=listeners.Any(x=>x.Port==port);Write((listening&&healthOk?"CORRECTO · ":"AVISO · ")+"Puerto "+port+": "+(listening?"ESCUCHANDO":"libre/no escuchando"));if(!listening)AddIssue("PORT_"+port,"El puerto "+port+" no está escuchando","Ningún proceso está atendiendo el puerto "+port+".","Reinicia el servicio y valida nuevamente. El puerto 443 también requiere certificado TLS válido.","Aviso");else if(!healthOk)AddIssue("PORT_OTHER_"+port,"El puerto "+port+" está ocupado pero SAS no responde","Hay un proceso escuchando, pero /health no confirmó que sea SAS.","Reinicia servicios y valida el proceso propietario del puerto.","Aviso");}

    var certPath=Path.Combine(root.Text,@"certs\server.crt");
    if(File.Exists(certPath)){
      try{using(var cert=new X509Certificate2(certPath)){var days=(cert.NotAfter-DateTime.Now).TotalDays;Write((days<15?"AVISO · ":"CORRECTO · ")+"Certificado HTTPS válido hasta "+cert.NotAfter.ToString("yyyy-MM-dd")+" | "+cert.Subject);if(days<15)AddIssue("TLS_EXPIRING","El certificado HTTPS está por vencer","Vence el "+cert.NotAfter.ToString("yyyy-MM-dd")+".","Renueva el certificado antes de que falten 7 días y reinicia el servicio.","Aviso");}}
      catch(Exception ex){WriteError("Certificado HTTPS inválido: "+FriendlyError(ex.Message));AddIssue("TLS_INVALID","El certificado HTTPS no puede leerse",ex.Message,"Reinstala o renueva certs/server.crt y certs/server.key.","Error");}
    }else AddIssue("TLS_MISSING","No se encontró el certificado HTTPS",certPath,"Instala certs/server.crt y certs/server.key antes de publicar el servicio.","Error");

    if(healthOk&&installedVersion!="desconocida"&&activeVersion!=installedVersion){AddIssue("VERSION_MISMATCH","La versión activa no coincide con la instalada","Instalada: "+installedVersion+" · Activa: "+activeVersion,"Reinicia los servicios. Si no cambia, usa Reparar instalación.","Error");WriteError("La versión activa "+activeVersion+" no coincide con la instalada "+installedVersion+".");}
    if(zip!=null&&ParseVersion(availableVersion)>ParseVersion(installedVersion))WriteWarning("Hay una actualización lista: "+availableVersion+".");
    InspectRecentServerError();UpdateCards(healthOk);SetProgress(100,issues.Any(x=>x.Severity=="Error")?"Estado revisado: hay errores que requieren atención":"Estado actualizado");
  }

  void InspectTurnIpMonitor(){
    var monitor=Path.Combine(root.Text,@"turn\ip-monitor.json");var config=Path.Combine(root.Text,@"turn\turnserver.conf");
    try{
      if(File.Exists(monitor)){var json=File.ReadAllText(monitor);var statusMatch=Regex.Match(json,@"""status""\s*:\s*""([^""]+)""");var ipMatch=Regex.Match(json,@"""externalIp""\s*:\s*""([^""]+)""");var checkedMatch=Regex.Match(json,@"""checkedAt""\s*:\s*""([^""]+)""");var state=statusMatch.Success?statusMatch.Groups[1].Value:"desconocido";Write((state=="warning"?"AVISO · ":"CORRECTO · ")+"TURN IP dinámica: "+(ipMatch.Success?ipMatch.Groups[1].Value:"sin confirmar")+(checkedMatch.Success?" · revisada "+checkedMatch.Groups[1].Value:""));if(state=="warning")AddIssue("TURN_DYNAMIC_IP","No se pudo actualizar la IP pública de TURN",json,"Comprueba que PUBLIC_BASE_URL resuelva por DNS; se conserva la última configuración funcional.","Aviso");}
      else if(File.Exists(config))WriteWarning("TURN está configurado; el monitor de IP aparecerá después de la siguiente comprobación automática.");
    }catch(Exception ex){WriteWarning("No se pudo leer el monitor de IP TURN: "+FriendlyError(ex.Message));}
  }

  void InspectRecentServerError(){
    var path=Path.Combine(root.Text,@"logs\sas-server.err.log");if(!File.Exists(path))return;
    try{
      var info=new FileInfo(path);if(info.Length==0||info.LastWriteTimeUtc<DateTime.UtcNow.AddMinutes(-20))return;
      var recent=RecentTimestampedLog(File.ReadAllLines(path),TimeSpan.FromMinutes(20));
      if(String.IsNullOrWhiteSpace(recent))return;
      var diagnosis=DiagnoseOutput(recent);AddIssue(diagnosis.Code,diagnosis.Title,recent,diagnosis.Action,diagnosis.Severity);WriteWarning("Se encontraron errores de los últimos 20 minutos en logs/sas-server.err.log. Abre Problemas y soluciones.");
    }
    catch(Exception ex){AddIssue("LOG_READ","No se pudo leer el registro de errores",ex.Message,"Comprueba permisos sobre la carpeta logs.","Aviso");}
  }
  static string RecentTimestampedLog(string[] lines,TimeSpan window){
    var cutoff=DateTimeOffset.Now.Subtract(window);var selected=new List<string>();bool include=false;
    foreach(var line in lines.Skip(Math.Max(0,lines.Length-300))){
      var match=Regex.Match(line,@"^\[(?<timestamp>\d{4}-\d{2}-\d{2}T[^\]]+)\]");
      if(match.Success){DateTimeOffset timestamp;include=DateTimeOffset.TryParse(match.Groups["timestamp"].Value,out timestamp)&&timestamp>=cutoff;}
      if(include)selected.Add(line);
    }
    return String.Join(Environment.NewLine,selected).Trim();
  }
  Issue DiagnoseOutput(string text){
    var n=NormalizeEncoding(text);
    if(Regex.IsMatch(n,"being used by another process|utilizado en otro proceso|no puede obtener acceso al archivo",RegexOptions.IgnoreCase))return new Issue("FILE_LOCKED","Un servicio de SAS mantiene archivos abiertos",n,"La actualización corregida detiene Server y TURN antes de copiar. Actualiza el estado y aplica nuevamente la versión stable más reciente.","Error");
    if(Regex.IsMatch(n,"ERR_MODULE_NOT_FOUND|Cannot find module",RegexOptions.IgnoreCase))return new Issue("MODULE_MISSING","Falta un módulo de la aplicación",n,"Aplica la actualización validada más reciente o usa Reparar instalación. El paquete actual verifica todas las importaciones.","Error");
    if(Regex.IsMatch(n,"EADDRINUSE|address already in use",RegexOptions.IgnoreCase))return new Issue("PORT_IN_USE","Otro proceso ocupa un puerto de SAS",n,"Reinicia servicios desde esta consola; después valida qué proceso escucha en 80 y 443.","Error");
    if(Regex.IsMatch(n,"Unexpected token.*JSON|not valid JSON|ï»¿",RegexOptions.IgnoreCase))return new Issue("INVALID_JSON","Un archivo JSON tiene formato o codificación incorrectos",n,"Repara la instalación. La configuración y los datos se preservarán.","Error");
    if(Regex.IsMatch(n,"access.*denied|acceso denegado|UnauthorizedAccess",RegexOptions.IgnoreCase))return new Issue("ACCESS_DENIED","Windows rechazó el acceso",n,"Cierra y abre SAS Administrador como administrador; revisa permisos de C:/SAS.","Error");
    if(Regex.IsMatch(n,"ECONNREFUSED|No es posible conectar|connection refused",RegexOptions.IgnoreCase))return new Issue("CONNECTION_REFUSED","El servicio no acepta conexiones",n,"Reinicia el servicio y confirma que los puertos 80 y 443 estén escuchando.","Error");
    if(Regex.IsMatch(n,"certificate|certificado|TLS|SSL",RegexOptions.IgnoreCase))return new Issue("TLS_ERROR","Fallo de certificado o HTTPS",n,"Valida certs/server.crt y certs/server.key, su vigencia y el dominio setinfo.sytes.net.","Error");
    if(Regex.IsMatch(n,"RemainingScripts|ForEach-Object",RegexOptions.IgnoreCase))return new Issue("SCRIPT_DAMAGED","El script de servicios está incompleto o dañado",n,"Usa Reparar instalación con el canal stable más reciente.","Error");
    if(Regex.IsMatch(n,@"certs\certs\certs",RegexOptions.IgnoreCase))return new Issue("CERT_RECURSION","Se detectó una copia recursiva antigua de certificados",n,"Aplica la versión actual; el actualizador nuevo limpia y preserva el árbol correcto.","Error");
    return new Issue("SERVER_ERROR","El servidor registró un error reciente",n,"Copia el problema seleccionado y consulta a Codex para analizarlo.","Aviso");
  }

  void UpdateCards(bool healthOk){installedCard.Text="Instalada: "+installedVersion;availableCard.Text="Disponible: "+availableVersion;serviceCard.Text="Servicio: "+serviceState;healthCard.Text="Salud: "+(healthOk?"Correcta":"Sin respuesta");serviceCard.BackColor=serviceState=="En ejecución"?Color.FromArgb(47,104,76):Color.FromArgb(126,67,60);healthCard.BackColor=healthOk?Color.FromArgb(47,104,76):Color.FromArgb(126,67,60);}
  static string TranslateServiceStatus(ServiceControllerStatus value){if(value==ServiceControllerStatus.Running)return "En ejecución";if(value==ServiceControllerStatus.Stopped)return "Detenido";if(value==ServiceControllerStatus.StartPending)return "Iniciando";if(value==ServiceControllerStatus.StopPending)return "Deteniendo";if(value==ServiceControllerStatus.Paused)return "Pausado";return value.ToString();}

  void ClearIssues(){issues.Clear();issuesView.Items.Clear();issueDetail.Clear();UpdateProblemCount();}
  void AddIssue(string code,string title,string detail,string action,string severity){detail=NormalizeEncoding(detail);var existing=issues.FirstOrDefault(x=>x.Code==code&&x.Title==title);if(existing!=null){existing.Detail=detail;existing.Action=action;existing.Severity=severity;RenderIssues();return;}issues.Add(new Issue(code,title,detail,action,severity));RenderIssues();}
  void RenderIssues(){issuesView.BeginUpdate();issuesView.Items.Clear();foreach(var issue in issues.OrderBy(x=>x.Severity=="Error"?0:1)){var item=new ListViewItem(issue.Severity);item.SubItems.Add(issue.Title);item.SubItems.Add(issue.Action);item.Tag=issue;item.ForeColor=issue.Severity=="Error"?Color.FromArgb(244,139,139):Color.FromArgb(239,196,111);issuesView.Items.Add(item);}issuesView.EndUpdate();UpdateProblemCount();}
  void UpdateProblemCount(){int errors=issues.Count(x=>x.Severity=="Error"),warnings=issues.Count-errors;problemCount.Text=issues.Count==0?"Sin problemas detectados":errors+" error(es) · "+warnings+" aviso(s). Selecciona uno para ver todos los detalles.";}
  void ShowSelectedIssue(){if(issuesView.SelectedItems.Count==0)return;var x=issuesView.SelectedItems[0].Tag as Issue;if(x==null)return;issueDetail.Text="Código: "+x.Code+Environment.NewLine+"Nivel: "+x.Severity+Environment.NewLine+Environment.NewLine+"Problema"+Environment.NewLine+x.Title+Environment.NewLine+Environment.NewLine+"Detalle técnico"+Environment.NewLine+x.Detail+Environment.NewLine+Environment.NewLine+"Acción recomendada"+Environment.NewLine+x.Action;}
  void CopySelectedIssue(){if(String.IsNullOrWhiteSpace(issueDetail.Text)){WriteWarning("Selecciona primero un problema.");return;}Clipboard.SetText(Sanitize(issueDetail.Text));WriteSuccess("Problema copiado sin secretos.");}
  void Backup(){SetProgress(5,"Preparando respaldo...");var d=Path.Combine(Path.GetDirectoryName(root.Text),"Backups","SAS-"+DateTime.Now.ToString("yyyyMMdd-HHmmss"));Directory.CreateDirectory(d);CopyTree(root.Text,d);WriteSuccess("Respaldo creado: "+d);SetProgress(100,"Respaldo terminado");}
  static void CopyTree(string src,string dst){foreach(var f in Directory.GetFiles(src)){var n=Path.GetFileName(f);if(n.Equals(".env.production",StringComparison.OrdinalIgnoreCase)||n.Equals("package.json",StringComparison.OrdinalIgnoreCase))File.Copy(f,Path.Combine(dst,n),true);}foreach(var dir in Directory.GetDirectories(src)){var n=Path.GetFileName(dir);if(n=="runtime"||n=="node_modules"||n=="logs"||n=="updates"||n=="Backups")continue;var t=Path.Combine(dst,n);Directory.CreateDirectory(t);CopyTree(dir,t);}}
  void CleanTasks(){if(MessageBox.Show("¿Eliminar solamente las tareas SAS antiguas? Los servicios nuevos no se eliminarán.","Confirmar limpieza",MessageBoxButtons.YesNo,MessageBoxIcon.Warning)!=DialogResult.Yes)return;SetProgress(10,"Limpiando tareas...");foreach(var n in oldTasks){var q=Run("schtasks.exe","/Delete /TN \""+n+"\" /F",60000);if(q.ExitCode==0)WriteSuccess("Tarea eliminada: "+n);else Write("Tarea ausente o no eliminada: "+n);}SetProgress(100,"Limpieza terminada");}
  void ValidateFlow(){
    SetProgress(5,"Validando sistema...");int ok=0,fail=0;
    Action<string,bool,string> check=(name,result,action)=>{if(result){WriteSuccess(name);ok++;}else{WriteError(name);fail++;AddIssue("VALIDATION_"+fail,name,"La validación automática devolvió un resultado negativo.",action,"Error");}};
    check("Ruta de instalación",Directory.Exists(root.Text),"Confirma la ruta C:/SAS/Server.");
    check("package.json",File.Exists(Path.Combine(root.Text,"package.json")),"Usa Reparar instalación.");
    check("Runtime Node",File.Exists(Path.Combine(root.Text,@"runtime\node\node.exe")),"Usa Reparar instalación para restaurar runtime\node\node.exe.");
    check("Espacio disponible",Directory.Exists(root.Text)&&new DriveInfo(Path.GetPathRoot(root.Text)).AvailableFreeSpace>500L*1024*1024,"Libera al menos 500 MB en la unidad.");
    var zip=LatestPackage();check("Canal accesible",Directory.Exists(Path.Combine(share.Text,channel.Text)),"Comprueba red y permisos sobre el recurso compartido.");check("Paquete disponible",zip!=null,"Publica una versión en el canal seleccionado.");
    string err=null;check("Manifiesto y SHA-256",zip!=null&&ValidatePackage(zip,out err),err??"Vuelve a publicar el paquete validado.");check("Script de actualización",File.Exists(Path.Combine(root.Text,@"scripts\update-server-deployment.ps1")),"Usa Reparar instalación.");
    try{using(var wc=new WebClient()){wc.DownloadString("http://127.0.0.1/health");check("Servicio HTTP saludable",true,"");}}catch(Exception ex){check("Servicio HTTP saludable",false,FriendlyError(ex.Message));}
    Write((fail==0?"CORRECTO · ":"ERROR · ")+"Resultado: "+ok+" correctas, "+fail+" fallas");SetProgress(fail==0?100:0,fail==0?"Sistema listo":"Revisión requerida");if(fail>0)tabs.SelectedTab=issuesTab;
  }

  string BuildApplyScript(string zip,string stage){var qzip=zip.Replace("'","''");var qstage=stage.Replace("'","''");var qroot=root.Text.Replace("'","''");return "$ErrorActionPreference='Stop'\nif(Test-Path -LiteralPath '"+qstage+"'){Remove-Item -LiteralPath '"+qstage+"' -Recurse -Force}\nNew-Item -ItemType Directory -Force -Path '"+qstage+"'|Out-Null\nExpand-Archive -LiteralPath '"+qzip+"' -DestinationPath '"+qstage+"' -Force\n& '"+Path.Combine(stage,@"scripts\update-server-deployment.ps1").Replace("'","''")+"' -SourcePath '"+qstage+"' -InstallPath '"+qroot+"' -StartAfterUpdate 1\nif($LASTEXITCODE -ne 0){exit $LASTEXITCODE}\n";}
  void ApplyPackage(bool allowSameVersion,string operation){
    var zip=LatestPackage();if(zip==null){AddIssue("NO_PACKAGE","No hay paquete disponible","Canal: "+channel.Text,"Actualiza el estado o revisa el recurso compartido.","Error");WriteError("No hay paquete en el canal seleccionado.");SetProgress(0,operation+" fallida");tabs.SelectedTab=issuesTab;return;}
    string error;if(!ValidatePackage(zip,out error)){AddIssue("PACKAGE_REJECTED","El paquete fue rechazado",error,"No intentes instalarlo. Vuelve a publicar un ZIP validado.","Error");WriteError("Paquete rechazado: "+error);SetProgress(0,operation+" fallida");tabs.SelectedTab=issuesTab;return;}
    var installed=ParseVersion(PackageVersion(Path.Combine(root.Text,"package.json")));var available=ParseVersion(VersionFromZip(zip));
    if(available<installed){WriteError("Paquete rechazado: no se permite regresar de "+installed+" a "+available+".");SetProgress(0,operation+" cancelada");return;}
    if(!allowSameVersion&&available<=installed){WriteSuccess("Ya está instalada la versión "+installed+".");SetProgress(100,"Sin cambios");return;}
    var stage=Path.Combine(root.Text,@"updates\admin-stage");var temp=Path.Combine(Path.GetTempPath(),"sas-update-"+Guid.NewGuid().ToString("N")+".ps1");
    File.WriteAllText(temp,BuildApplyScript(zip,stage),new UTF8Encoding(false));SetProgress(20,"Verificando y aplicando paquete...");
    var r=Run("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+temp+"\"",900000);try{File.Delete(temp);}catch{}
    RefreshState();Write("Paquete: "+zip);Write("Código de salida: "+r.ExitCode);WriteProcessResult(operation,r);SetProgress(r.ExitCode==0?100:0,r.ExitCode==0?operation+" terminada":operation+" fallida; la versión anterior debió restaurarse");
  }
  void WriteProcessResult(string operation,P result){if(!String.IsNullOrWhiteSpace(result.Stdout))Write(result.Stdout);if(result.ExitCode==0){WriteSuccess(operation+" completada.");return;}var combined=(result.Stderr+Environment.NewLine+result.Stdout).Trim();var diagnosis=DiagnoseOutput(combined);AddIssue(diagnosis.Code,diagnosis.Title,combined,diagnosis.Action,diagnosis.Severity);WriteError(operation+" terminó con código "+result.ExitCode+". "+diagnosis.Title);tabs.SelectedTab=issuesTab;}
  void Repair(){if(MessageBox.Show("Se reinstalará la versión stable y se conservarán datos, configuración y certificados.","Confirmar reparación",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes)ApplyPackage(true,"Reparación");}
  void UpdateVersion(){if(MessageBox.Show("Se aplicará la versión stable verificada. Si falla la salud, se restaurará automáticamente la versión anterior.","Confirmar actualización",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes)ApplyPackage(false,"Actualización");}
  void OpenServerConfiguration(){
    if(!IsAdministrator()){MessageBox.Show("Abre SAS Administrador como administrador para modificar la configuración y reiniciar servicios.","Se requiere administrador",MessageBoxButtons.OK,MessageBoxIcon.Warning);return;}
    using(var dialog=new ServerConfigurationDialog(root.Text)){
      if(dialog.ShowDialog(this)!=DialogResult.OK||dialog.Result==null)return;
      var configuration=dialog.Result;if(!configuration.AnyChanged){WriteSuccess("La configuración ya estaba actualizada; no fue necesario reiniciar.");return;}
      SetProgress(20,"Aplicando configuración...");WriteSuccess("Respaldo de configuración: "+configuration.BackupPath);
      var result=RunConfiguredServices(configuration.Values,configuration.TurnServiceChanged);
      if(result.ExitCode!=0){
        WriteError("No fue posible iniciar con la nueva configuración. Restaurando respaldo...");
        try{File.Copy(configuration.BackupPath,Path.Combine(root.Text,".env.production"),true);var rollback=RunConfiguredServices(configuration.OriginalValues,configuration.TurnServiceChanged);if(rollback.ExitCode==0)WriteSuccess("Configuración anterior restaurada y servicios recuperados.");else WriteError("La configuración se restauró, pero los servicios requieren revisión: "+rollback.Stderr);}
        catch(Exception ex){WriteError("No fue posible completar la reversión: "+FriendlyError(ex.Message));}
        WriteProcessResult("Aplicación de configuración",result);SetProgress(0,"Configuración revertida");RefreshState();return;
      }
      WriteSuccess("Configuración guardada y servicios aplicados.");if(configuration.TurnServiceChanged&&!ServiceInstalled("SAS Support TURN"))WriteWarning("Los valores TURN quedaron guardados. Usa Configurar TURN cuando quieras instalar el servicio.");SetProgress(100,"Configuración aplicada");RefreshState();
    }
  }
  P RunConfiguredServices(Dictionary<string,string> values,bool turnChanged){
    if(turnChanged&&ServiceInstalled("SAS Support TURN")){
      var script=Path.Combine(root.Text,@"scripts\install-sas-turn-service.ps1");if(!File.Exists(script))return new P{ExitCode=1,Stdout="",Stderr="Falta install-sas-turn-service.ps1"};
      var args="-NoProfile -ExecutionPolicy Bypass -File "+QuoteArgument(script)+" -InstallPath "+QuoteArgument(root.Text)+" -PublicHost "+QuoteArgument(values["SAS_TURN_PUBLIC_HOST"])+" -ListeningPort "+values["SAS_TURN_LISTENING_PORT"]+" -TlsPort "+values["SAS_TURN_TLS_PORT"]+" -RelayMinPort "+values["WEBRTC_UDP_MIN_PORT"]+" -RelayMaxPort "+values["WEBRTC_UDP_MAX_PORT"];
      return Run("powershell.exe",args,240000);
    }
    var serviceScript=Path.Combine(root.Text,@"scripts\install-sas-services.ps1");if(!File.Exists(serviceScript))return new P{ExitCode=1,Stdout="",Stderr="Falta install-sas-services.ps1"};
    return Run("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File "+QuoteArgument(serviceScript)+" -ProjectDir "+QuoteArgument(root.Text)+" -NodeExe "+QuoteArgument(Path.Combine(root.Text,@"runtime\node\node.exe")),180000);
  }
  static string QuoteArgument(string value){return "\""+(value??"").Replace("\"","\\\"")+"\"";}
  static bool ServiceInstalled(string name){try{return ServiceController.GetServices().Any(x=>x.ServiceName.Equals(name,StringComparison.OrdinalIgnoreCase));}catch{return false;}}

  void ConfigureTurn(){
    var script=Path.Combine(root.Text,@"scripts\install-sas-turn-service.ps1");var engine=Path.Combine(root.Text,@"tools\coturn\turnserver.exe");
    if(!File.Exists(script)){AddIssue("TURN_SCRIPT_MISSING","Falta el instalador TURN",script,"Actualiza o repara SAS antes de configurar TURN.","Error");tabs.SelectedTab=issuesTab;return;}
    if(!File.Exists(engine)){AddIssue("TURN_ENGINE_MISSING","Falta el motor coturn verificado",engine,"Actualiza SAS con el paquete que incluye coturn oficial para Windows.","Error");tabs.SelectedTab=issuesTab;return;}
    if(MessageBox.Show("Se instalará SAS Support TURN, se abrirán sus puertos locales y se reiniciará el servicio web de SAS. La configuración y los datos se conservarán.","Configurar TURN",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;
    SetProgress(10,IsAdministrator()?"Configurando TURN...":"Esperando autorización de Windows...");
    var arguments="-NoProfile -ExecutionPolicy Bypass -File \""+script+"\" -InstallPath \""+root.Text+"\"";
    var r=IsAdministrator()?Run("powershell.exe",arguments,240000):RunElevatedScript(script,root.Text,240000);
    RefreshState();WriteProcessResult("Configuración TURN",r);SetProgress(r.ExitCode==0?100:0,r.ExitCode==0?"TURN listo":"TURN no pudo configurarse");
  }
  void CopyDiagnostic(){Clipboard.SetText(Sanitize(BuildDiagnosticSummary()));WriteSuccess("Diagnóstico completo copiado sin secretos.");}
  void StopStaleSasProcesses(){try{using(var searcher=new ManagementObjectSearcher("SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name='node.exe'")){foreach(ManagementObject p in searcher.Get()){var cmd=(p["CommandLine"]??"").ToString();if(cmd.IndexOf(@"src\server.js",StringComparison.OrdinalIgnoreCase)>=0&&cmd.IndexOf(root.Text,StringComparison.OrdinalIgnoreCase)>=0){try{Process.GetProcessById(Convert.ToInt32(p["ProcessId"])).Kill();WriteWarning("Proceso anterior detenido: PID "+p["ProcessId"]);}catch{}}}}}catch(Exception ex){WriteWarning("No se pudieron revisar procesos anteriores: "+FriendlyError(ex.Message));}}
  void RestartServices(){
    SetProgress(10,"Reiniciando servicios...");StopStaleSasProcesses();var script=Path.Combine(root.Text,@"scripts\install-sas-services.ps1");
    if(!File.Exists(script)){AddIssue("SERVICE_SCRIPT_MISSING","Falta el instalador de servicios",script,"Usa Reparar instalación para restaurarlo.","Error");WriteError("Falta install-sas-services.ps1");SetProgress(0,"Reinicio fallido");tabs.SelectedTab=issuesTab;return;}
    var r=Run("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+script+"\" -ProjectDir \""+root.Text+"\" -NodeExe \""+Path.Combine(root.Text,@"runtime\node\node.exe")+"\"",180000);
    RefreshState();WriteProcessResult("Reinicio de servicios",r);SetProgress(r.ExitCode==0?100:0,r.ExitCode==0?"Servicios listos":"Reinicio fallido");
  }

  void PrepareCodexRequest(){
    codexRequest.Text=BuildCodexPrompt();var dir=Path.Combine(root.Text,@"logs\codex-requests");Directory.CreateDirectory(dir);
    lastCodexFile=Path.Combine(dir,"consulta-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".md");File.WriteAllText(lastCodexFile,codexRequest.Text,new UTF8Encoding(false));
    tabs.SelectedTab=codexTab;WriteSuccess("Consulta preparada y guardada en "+lastCodexFile);
  }
  void CopyCodexRequest(){if(String.IsNullOrWhiteSpace(codexRequest.Text))PrepareCodexRequest();Clipboard.SetText(codexRequest.Text);WriteSuccess("Consulta copiada. Pégala en Codex.");}
  void OpenCodex(){CopyCodexRequest();Process.Start(new ProcessStartInfo("https://chatgpt.com/codex"){UseShellExecute=true});WriteWarning("Codex se abrió. Pega la consulta copiada; por seguridad no se envía automáticamente.");}
  void SaveCodexResponse(){
    if(String.IsNullOrWhiteSpace(codexResponse.Text)){WriteWarning("Pega primero la respuesta de Codex.");return;}
    var dir=Path.Combine(root.Text,@"logs\codex-requests");Directory.CreateDirectory(dir);var baseName=String.IsNullOrWhiteSpace(lastCodexFile)?"respuesta-"+DateTime.Now.ToString("yyyyMMdd-HHmmss"):Path.GetFileNameWithoutExtension(lastCodexFile)+"-respuesta";
    var file=Path.Combine(dir,baseName+".md");File.WriteAllText(file,Sanitize(codexResponse.Text),new UTF8Encoding(false));WriteSuccess("Respuesta guardada en "+file);
  }
  string BuildCodexPrompt(){
    var b=new StringBuilder();b.AppendLine("# Solicitud de diagnóstico SAS para Codex");b.AppendLine();
    b.AppendLine("Necesito analizar este problema de SAS Support Platform. Prioriza una solución segura, reversible y que preserve configuración, datos y certificados.");
    b.AppendLine("No supongas que una operación tuvo éxito: indica cómo verificarla desde SAS Administrador.");b.AppendLine();b.AppendLine("## Resumen");
    b.AppendLine("- Fecha: "+DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));b.AppendLine("- Equipo: "+Environment.MachineName);b.AppendLine("- Windows: "+Environment.OSVersion.VersionString);b.AppendLine("- Administrador: "+(IsAdministrator()?"sí":"no"));
    b.AppendLine("- Ruta: "+root.Text);b.AppendLine("- Canal: "+channel.Text);b.AppendLine("- Versión instalada: "+installedVersion);b.AppendLine("- Versión activa: "+activeVersion);b.AppendLine("- Versión disponible: "+availableVersion);b.AppendLine("- Servicio: "+serviceState);
    b.AppendLine();b.AppendLine("## Problemas detectados");if(issues.Count==0)b.AppendLine("- Ninguno registrado.");
    foreach(var x in issues){b.AppendLine("### ["+x.Severity+"] "+x.Title);b.AppendLine("Código: "+x.Code);b.AppendLine("Detalle: "+x.Detail);b.AppendLine("Acción sugerida por SAS: "+x.Action);b.AppendLine();}
    b.AppendLine("## Actividad reciente");var recent=log.Text??"";if(recent.Length>14000)recent=recent.Substring(recent.Length-14000);b.AppendLine(recent);b.AppendLine();
    b.AppendLine("Responde con: causa probable, comprobaciones, corrección recomendada, riesgo, reversión y señal exacta de éxito.");return Sanitize(b.ToString());
  }
  string BuildDiagnosticSummary(){var b=new StringBuilder();b.AppendLine("SAS Administrador");b.AppendLine("Instalada: "+installedVersion);b.AppendLine("Activa: "+activeVersion);b.AppendLine("Disponible: "+availableVersion);b.AppendLine("Servicio: "+serviceState);b.AppendLine();foreach(var x in issues)b.AppendLine("["+x.Severity+"] "+x.Code+" · "+x.Title+Environment.NewLine+x.Detail+Environment.NewLine+"Acción: "+x.Action+Environment.NewLine);b.AppendLine("Actividad:");b.AppendLine(log.Text);return b.ToString();}
  static bool IsAdministrator(){var principal=new WindowsPrincipal(WindowsIdentity.GetCurrent());return principal.IsInRole(WindowsBuiltInRole.Administrator);}
  static string Sanitize(string value){
    if(String.IsNullOrEmpty(value))return "";var s=value;
    s=Regex.Replace(s,@"(?im)^(.*(?:TOKEN|SECRET|PASSWORD|API[_ -]?KEY|PRIVATE[_ -]?KEY).*)$","[SECRETO OCULTO]");
    s=Regex.Replace(s,@"(?i)Bearer\s+[A-Za-z0-9._~+\-/=]+","Bearer [OCULTO]");
    s=Regex.Replace(s,@"(?i)(Authorization\s*[:=]\s*)[^\r\n]+","$1[OCULTO]");
    s=Regex.Replace(s,@"(?i)(-----BEGIN [^-]*PRIVATE KEY-----)[\s\S]*?(-----END [^-]*PRIVATE KEY-----)","$1\n[OCULTO]\n$2");return s;
  }
  static string FriendlyError(string message){var m=NormalizeEncoding(message);if(Regex.IsMatch(m,"access.*denied|acceso denegado",RegexOptions.IgnoreCase))return "Acceso denegado por Windows. Abre SAS Administrador como administrador.";if(Regex.IsMatch(m,"network path.*not found|ruta de acceso de red",RegexOptions.IgnoreCase))return "No se encontró el recurso de red. Comprueba SERVER y la conexión.";if(Regex.IsMatch(m,"connection refused|No es posible conectar|Unable to connect to the remote server",RegexOptions.IgnoreCase))return "El servicio no está aceptando conexiones.";return m;}
  static string FullException(Exception ex){var b=new StringBuilder();for(var current=ex;current!=null;current=current.InnerException)b.AppendLine(current.GetType().Name+": "+current.Message);return NormalizeEncoding(b.ToString());}
  static string NormalizeEncoding(string value){if(String.IsNullOrEmpty(value)||(!value.Contains("Ã")&&!value.Contains("Â")&&!value.Contains("ï»¿")))return value??"";try{return Encoding.UTF8.GetString(Encoding.GetEncoding(1252).GetBytes(value));}catch{return value;}}

  static P Run(string file,string args,int timeoutMs){
    try{using(var p=new Process()){p.StartInfo.FileName=file;p.StartInfo.Arguments=args;p.StartInfo.UseShellExecute=false;p.StartInfo.CreateNoWindow=true;p.StartInfo.RedirectStandardOutput=true;p.StartInfo.RedirectStandardError=true;p.Start();var stdout=p.StandardOutput.ReadToEndAsync();var stderr=p.StandardError.ReadToEndAsync();if(!p.WaitForExit(timeoutMs)){try{p.Kill();}catch{}return new P{ExitCode=-2,Stdout=stdout.IsCompleted?stdout.Result:"",Stderr="La operación excedió el tiempo máximo de espera."};}Task.WaitAll(stdout,stderr);return new P{ExitCode=p.ExitCode,Stdout=NormalizeEncoding(stdout.Result),Stderr=NormalizeEncoding(stderr.Result)};}}
    catch(Exception ex){return new P{ExitCode=-1,Stdout="",Stderr=FullException(ex)};}
  }
  static P RunElevatedScript(string script,string installPath,int timeoutMs){
    var token=Guid.NewGuid().ToString("N");var wrapper=Path.Combine(Path.GetTempPath(),"sas-elevated-"+token+".ps1");var resultFile=Path.Combine(Path.GetTempPath(),"sas-elevated-"+token+".log");
    try{
      var escapedScript=script.Replace("'","''");var escapedRoot=installPath.Replace("'","''");var escapedResult=resultFile.Replace("'","''");
      var wrapperText="$ErrorActionPreference='Stop'\r\ntry {\r\n  & '"+escapedScript+"' -InstallPath '"+escapedRoot+"' *>&1 | Out-File -LiteralPath '"+escapedResult+"' -Encoding utf8\r\n  exit 0\r\n} catch {\r\n  ($_ | Out-String) | Out-File -LiteralPath '"+escapedResult+"' -Encoding utf8 -Append\r\n  exit 1\r\n}\r\n";
      File.WriteAllText(wrapper,wrapperText,new UTF8Encoding(false));
      using(var p=new Process()){
        p.StartInfo.FileName="powershell.exe";p.StartInfo.Arguments="-NoProfile -ExecutionPolicy Bypass -File \""+wrapper+"\"";p.StartInfo.UseShellExecute=true;p.StartInfo.Verb="runas";p.StartInfo.WindowStyle=ProcessWindowStyle.Hidden;
        p.Start();
        if(!p.WaitForExit(timeoutMs)){try{p.Kill();}catch{}return new P{ExitCode=-2,Stdout="",Stderr="La operación elevada excedió el tiempo máximo de espera."};}
        var output=File.Exists(resultFile)?NormalizeEncoding(File.ReadAllText(resultFile)):"";
        return new P{ExitCode=p.ExitCode,Stdout=p.ExitCode==0?output:"",Stderr=p.ExitCode==0?"":output};
      }
    }catch(System.ComponentModel.Win32Exception ex){
      return new P{ExitCode=-3,Stdout="",Stderr=ex.NativeErrorCode==1223?"La autorización de Windows fue cancelada. No se realizó ningún cambio.":FullException(ex)};
    }catch(Exception ex){return new P{ExitCode=-1,Stdout="",Stderr=FullException(ex)};}
    finally{try{if(File.Exists(wrapper))File.Delete(wrapper);}catch{}try{if(File.Exists(resultFile))File.Delete(resultFile);}catch{}}
  }

  [STAThread] static void Main(){
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
    SasAdminConsole form=null;Application.ThreadException+=(s,e)=>{if(form!=null)form.ReportException("Error de interfaz",e.Exception);};form=new SasAdminConsole();Application.Run(form);
  }
  class P{public int ExitCode;public string Stdout,Stderr;}
  class Issue{public string Code,Title,Detail,Action,Severity;public Issue(string code,string title,string detail,string action,string severity){Code=code;Title=title;Detail=detail;Action=action;Severity=severity;}}
}