using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

class ServerConfigurationResult {
  public Dictionary<string,string> Values;
  public Dictionary<string,string> OriginalValues;
  public string BackupPath;
  public bool TurnServiceChanged;
  public bool AnyChanged;
}

class ServerConfigurationDialog : Form {
  readonly string installPath;
  readonly string envPath;
  readonly Dictionary<string,string> originalValues=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
  readonly Dictionary<string,Control> fields=new Dictionary<string,Control>(StringComparer.OrdinalIgnoreCase);
  readonly List<string> originalLines=new List<string>();
  readonly Label validationLabel;
  public ServerConfigurationResult Result { get; private set; }

  static readonly Dictionary<string,string> Defaults=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase){
    {"PUBLIC_BASE_URL","https://setinfo.sytes.net"},{"ENABLE_HTTP","true"},{"HTTP_PORT","80"},{"ENABLE_HTTPS","true"},{"HTTPS_PORT","443"},{"TLS_CERT_PATH","certs/server.crt"},{"TLS_KEY_PATH","certs/server.key"},{"DATA_FILE_PATH","data/sas-db.json"},{"BACKUP_DIR","data/backups"},
    {"WEBRTC_ENABLED","true"},{"WEBRTC_STUN_URLS","stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478"},{"SAS_TURN_PUBLIC_HOST","setinfo.sytes.net"},{"SAS_TURN_LISTENING_PORT","3478"},{"SAS_TURN_TLS_PORT","5349"},{"WEBRTC_UDP_MIN_PORT","49152"},{"WEBRTC_UDP_MAX_PORT","49200"},{"WEBRTC_TURN_CREDENTIAL_TTL_SECONDS","600"},{"SAS_TURN_IP_REFRESH_SECONDS","60"},
    {"AGENT_HEARTBEAT_SECONDS","2"},{"REMOTE_SESSION_TTL_MINUTES","60"},{"CLIENT_ENROLLMENT_TTL_MINUTES","60"},{"MOBILE_ACCESS_TTL_MINUTES","15"},{"SHORT_URL_TIMEOUT_MS","5000"},
    {"UPDATE_CHECK_ENABLED","true"},{"UPDATE_APPLY_ENABLED","true"},{"UPDATE_CHANNEL","stable"},{"UPDATE_BASE_URL","https://setinfo.sytes.net/updates"},{"UPDATE_HEALTH_URL","https://setinfo.sytes.net/health"},{"UPDATE_TIMEOUT_MS","10000"},{"UPDATE_CHECK_INTERVAL_MINUTES","360"},{"UPDATE_DOWNLOAD_TIMEOUT_MS","180000"}
  };
  static readonly HashSet<string> TurnServiceKeys=new HashSet<string>(new[]{"SAS_TURN_PUBLIC_HOST","SAS_TURN_LISTENING_PORT","SAS_TURN_TLS_PORT","WEBRTC_UDP_MIN_PORT","WEBRTC_UDP_MAX_PORT","SAS_TURN_IP_REFRESH_SECONDS"},StringComparer.OrdinalIgnoreCase);

  public ServerConfigurationDialog(string root){
    installPath=Path.GetFullPath(root);envPath=Path.Combine(installPath,".env.production");
    Text="Configuración general de SAS Server";Width=820;Height=720;MinimumSize=new Size(720,620);StartPosition=FormStartPosition.CenterParent;BackColor=Color.FromArgb(28,32,36);ForeColor=Color.FromArgb(238,242,240);Font=new Font("Segoe UI",9.5F);
    ReadEnvironment();
    var header=new Panel{Dock=DockStyle.Top,Height=76,Padding=new Padding(18,11,18,8),BackColor=Color.FromArgb(43,50,48)};
    header.Controls.Add(new Label{Text="Configuración general del servidor",AutoSize=true,Left=18,Top=10,Font=new Font("Segoe UI Semibold",16F),ForeColor=Color.FromArgb(225,236,230)});
    header.Controls.Add(new Label{Text="Red, DNS, TURN, WebRTC y tiempos operativos. Los secretos permanecen ocultos y no se modifican.",AutoSize=true,Left=20,Top=43,ForeColor=Color.FromArgb(174,190,181)});
    var tabs=new TabControl{Dock=DockStyle.Fill,Padding=new Point(16,6)};
    tabs.TabPages.Add(BuildNetworkPage());tabs.TabPages.Add(BuildTurnPage());tabs.TabPages.Add(BuildTimesPage());tabs.TabPages.Add(BuildUpdatesPage());
    var bottom=new Panel{Dock=DockStyle.Bottom,Height=76,Padding=new Padding(14,9,14,9),BackColor=Color.FromArgb(43,50,48)};
    var bottomGrid=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,BackColor=Color.FromArgb(43,50,48)};bottomGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));bottomGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,385));
    validationLabel=new Label{Dock=DockStyle.Fill,Padding=new Padding(2,8,8,4),Text="Se creará un respaldo antes de guardar. Los servicios afectados se reiniciarán al aplicar.",ForeColor=Color.FromArgb(192,207,199)};
    var commands=new FlowLayoutPanel{Dock=DockStyle.Fill,FlowDirection=FlowDirection.LeftToRight,WrapContents=false,Padding=new Padding(4,8,0,0),BackColor=Color.FromArgb(43,50,48)};
    var validate=new Button{Text="Validar DNS",Width=110,Height=34,FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(69,88,80),ForeColor=Color.White};validate.Click+=(s,e)=>ValidateOnly();
    var cancel=new Button{Text="Cancelar",Width=105,Height=34,DialogResult=DialogResult.Cancel,FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(67,76,72),ForeColor=Color.White};
    var save=new Button{Text="Guardar y aplicar",Width=130,Height=34,FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(54,112,82),ForeColor=Color.White};save.Click+=(s,e)=>SaveAndClose();
    commands.Controls.Add(validate);commands.Controls.Add(cancel);commands.Controls.Add(save);bottomGrid.Controls.Add(validationLabel,0,0);bottomGrid.Controls.Add(commands,1,0);bottom.Controls.Add(bottomGrid);
    Controls.Add(tabs);Controls.Add(bottom);Controls.Add(header);AcceptButton=save;CancelButton=cancel;
  }

  TabPage BuildNetworkPage(){var page=NewPage("Red y HTTPS");var grid=NewGrid(page);
    AddInfo(grid,"Direcciones públicas y puertos del servicio. Cambiar el dominio aquí no modifica el registro en tu proveedor DNS.");
    AddText(grid,"URL pública","PUBLIC_BASE_URL","Dirección utilizada en ligas, WebRTC y callbacks públicos.");
    AddBool(grid,"Habilitar HTTP","ENABLE_HTTP","Mantiene disponible el acceso por HTTP.");AddText(grid,"Puerto HTTP","HTTP_PORT","Puerto TCP, normalmente 80.");
    AddBool(grid,"Habilitar HTTPS","ENABLE_HTTPS","Recomendado para producción y soporte remoto.");AddText(grid,"Puerto HTTPS","HTTPS_PORT","Puerto TLS, normalmente 443.");
    AddText(grid,"Certificado TLS","TLS_CERT_PATH","Ruta relativa a C:\\SAS\\Server o ruta absoluta.");AddText(grid,"Llave TLS","TLS_KEY_PATH","La llave no se muestra; aquí solo se configura su ruta.");
    AddText(grid,"Archivo de datos","DATA_FILE_PATH","Base JSON persistente de SAS.");AddText(grid,"Carpeta de respaldos","BACKUP_DIR","Destino de respaldos de datos.");return page;}
  TabPage BuildTurnPage(){var page=NewPage("TURN y WebRTC");var grid=NewGrid(page);
    AddInfo(grid,"TURN sigue automáticamente el DNS público. Si cambia la IP, conserva la última ruta funcional hasta resolver la nueva.");
    AddBool(grid,"Habilitar WebRTC","WEBRTC_ENABLED","Usa WebRTC y mantiene HTTPS como respaldo.");AddText(grid,"Servidores STUN","WEBRTC_STUN_URLS","Separados por coma; por ejemplo stun:servidor:3478.");
    AddText(grid,"Nombre DNS de TURN","SAS_TURN_PUBLIC_HOST","Dominio público que apunta a SERVER.");AddText(grid,"Puerto TURN","SAS_TURN_LISTENING_PORT","UDP/TCP, normalmente 3478.");AddText(grid,"Puerto TURN TLS","SAS_TURN_TLS_PORT","TCP/TLS, normalmente 5349.");
    AddText(grid,"Primer puerto relay","WEBRTC_UDP_MIN_PORT","Inicio del rango UDP/TCP reenviado por el router.");AddText(grid,"Último puerto relay","WEBRTC_UDP_MAX_PORT","Fin del rango relay.");
    AddText(grid,"Credencial temporal (segundos)","WEBRTC_TURN_CREDENTIAL_TTL_SECONDS","Vigencia de credenciales WebRTC; no muestra el secreto.");AddText(grid,"Revisión de IP (segundos)","SAS_TURN_IP_REFRESH_SECONDS","Frecuencia para comprobar cambios del DNS público.");return page;}
  TabPage BuildTimesPage(){var page=NewPage("Tiempos");var grid=NewGrid(page);
    AddInfo(grid,"Ajusta tiempos de conexión y sesiones. Los límites protegen al servidor de valores que puedan saturarlo.");
    AddText(grid,"Heartbeat del cliente (segundos)","AGENT_HEARTBEAT_SECONDS","Frecuencia de presencia de SAS Cliente.");AddText(grid,"Compatibilidad de sesión (minutos)","REMOTE_SESSION_TTL_MINUTES","Valor heredado: las sesiones de soporte ya no expiran y terminan únicamente por cierre explícito.");
    AddText(grid,"Liga de instalación (minutos)","CLIENT_ENROLLMENT_TTL_MINUTES","Vigencia del enlace temporal de asociación.");AddText(grid,"Sesión web (minutos)","MOBILE_ACCESS_TTL_MINUTES","Vigencia del token de acceso de técnicos.");
    AddText(grid,"Acortador URL (ms)","SHORT_URL_TIMEOUT_MS","Tiempo máximo de respuesta del proveedor de ligas.");return page;}
  TabPage BuildUpdatesPage(){var page=NewPage("Actualizaciones");var grid=NewGrid(page);
    AddInfo(grid,"Controla el canal y los tiempos de comprobación. La firma y las claves permanecen fuera de esta pantalla.");
    AddBool(grid,"Comprobar actualizaciones","UPDATE_CHECK_ENABLED","Consulta periódicamente el manifiesto configurado.");AddBool(grid,"Permitir aplicar","UPDATE_APPLY_ENABLED","Habilita el flujo de instalación validada.");
    AddChoice(grid,"Canal","UPDATE_CHANNEL",new[]{"stable","testing","client"},"Canal de publicación utilizado por SERVER.");AddText(grid,"URL de actualizaciones","UPDATE_BASE_URL","Ruta pública que contiene los canales.");AddText(grid,"URL de salud","UPDATE_HEALTH_URL","Comprobación utilizada después de actualizar.");
    AddText(grid,"Tiempo de consulta (ms)","UPDATE_TIMEOUT_MS","Espera para consultar el manifiesto.");AddText(grid,"Intervalo de revisión (minutos)","UPDATE_CHECK_INTERVAL_MINUTES","Entre 15 minutos y 7 días.");AddText(grid,"Tiempo de descarga (ms)","UPDATE_DOWNLOAD_TIMEOUT_MS","Tiempo máximo para descargar un paquete.");return page;}

  TabPage NewPage(string title){return new TabPage(title){BackColor=Color.FromArgb(30,35,37),ForeColor=Color.FromArgb(236,240,238),Padding=new Padding(8)};}
  TableLayoutPanel NewGrid(TabPage page){var holder=new Panel{Dock=DockStyle.Fill,AutoScroll=true,Padding=new Padding(10)};var grid=new TableLayoutPanel{Dock=DockStyle.Top,AutoSize=true,ColumnCount=2,BackColor=Color.FromArgb(30,35,37),Padding=new Padding(6)};grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,245));grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));holder.Controls.Add(grid);page.Controls.Add(holder);return grid;}
  void AddInfo(TableLayoutPanel grid,string text){var label=new Label{Text=text,Dock=DockStyle.Fill,Height=48,Padding=new Padding(10),ForeColor=Color.FromArgb(194,211,202),BackColor=Color.FromArgb(38,47,44),AutoSize=false};int row=grid.RowCount++;grid.RowStyles.Add(new RowStyle(SizeType.Absolute,58));grid.Controls.Add(label,0,row);grid.SetColumnSpan(label,2);}
  void AddText(TableLayoutPanel grid,string label,string key,string hint){var box=new TextBox{Dock=DockStyle.Fill,Text=ReadValue(key),BackColor=Color.FromArgb(245,248,247),ForeColor=Color.FromArgb(25,35,31),Margin=new Padding(5,8,10,8)};fields[key]=box;AddRow(grid,label,box,hint);}
  void AddBool(TableLayoutPanel grid,string label,string key,string hint){var check=new CheckBox{Dock=DockStyle.Left,AutoSize=true,Checked=ReadValue(key).Equals("true",StringComparison.OrdinalIgnoreCase),Text=hint,ForeColor=Color.FromArgb(213,224,218),Margin=new Padding(6,9,6,6)};fields[key]=check;AddRow(grid,label,check,hint);}
  void AddChoice(TableLayoutPanel grid,string label,string key,string[] choices,string hint){var combo=new ComboBox{Dock=DockStyle.Left,Width=200,DropDownStyle=ComboBoxStyle.DropDownList,Margin=new Padding(5,7,10,7)};combo.Items.AddRange(choices);combo.SelectedItem=ReadValue(key);if(combo.SelectedIndex<0)combo.SelectedIndex=0;fields[key]=combo;AddRow(grid,label,combo,hint);}
  void AddRow(TableLayoutPanel grid,string label,Control control,string hint){int row=grid.RowCount++;grid.RowStyles.Add(new RowStyle(SizeType.Absolute,50));var caption=new Label{Text=label,Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleLeft,ForeColor=Color.FromArgb(225,232,228),Padding=new Padding(5)};grid.Controls.Add(caption,0,row);grid.Controls.Add(control,1,row);new ToolTip().SetToolTip(control,hint);}

  void ReadEnvironment(){if(!File.Exists(envPath))throw new FileNotFoundException("No se encontró .env.production",envPath);originalLines.AddRange(File.ReadAllLines(envPath,Encoding.UTF8));foreach(var line in originalLines){var trimmed=line.Trim();if(trimmed.Length==0||trimmed.StartsWith("#"))continue;int split=line.IndexOf('=');if(split<=0)continue;var key=line.Substring(0,split).Trim();if(!originalValues.ContainsKey(key))originalValues[key]=line.Substring(split+1).Trim();}}
  string ReadValue(string key){string value;if(originalValues.TryGetValue(key,out value)&&!String.IsNullOrWhiteSpace(value))return value;return Defaults.ContainsKey(key)?Defaults[key]:"";}
  Dictionary<string,string> CollectValues(){var values=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(var pair in fields){var check=pair.Value as CheckBox;var combo=pair.Value as ComboBox;values[pair.Key]=check!=null?(check.Checked?"true":"false"):combo!=null?(combo.SelectedItem??"").ToString():pair.Value.Text.Trim();}return values;}
  void ValidateOnly(){var values=CollectValues();string error;if(!ValidateValues(values,out error)){validationLabel.Text=error;validationLabel.ForeColor=Color.FromArgb(244,139,139);return;}try{var addresses=Dns.GetHostAddresses(values["SAS_TURN_PUBLIC_HOST"]);var visible=String.Join(", ",addresses.Select(x=>x.ToString()).Take(3).ToArray());validationLabel.Text=addresses.Length>0?"Configuración válida. TURN resuelve a: "+visible:"La configuración es válida, pero el DNS de TURN no devolvió direcciones.";validationLabel.ForeColor=addresses.Length>0?Color.FromArgb(126,218,166):Color.FromArgb(246,196,109);}catch(Exception ex){validationLabel.Text="La configuración es válida, pero TURN no resuelve todavía: "+ex.Message;validationLabel.ForeColor=Color.FromArgb(246,196,109);}}
  void SaveAndClose(){try{var values=CollectValues();string error;if(!ValidateValues(values,out error)){validationLabel.Text=error;validationLabel.ForeColor=Color.FromArgb(244,139,139);return;}var changed=values.Keys.Where(k=>!ReadValue(k).Equals(values[k],StringComparison.Ordinal)).ToList();if(changed.Count==0){Result=new ServerConfigurationResult{Values=values,OriginalValues=BuildOriginalSnapshot(values.Keys),BackupPath=null,TurnServiceChanged=false,AnyChanged=false};DialogResult=DialogResult.OK;Close();return;}if(MessageBox.Show("Se modificarán "+changed.Count+" parámetros y se reiniciarán los servicios afectados. ¿Continuar?","Aplicar configuración",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;var backup=WriteEnvironment(values);Result=new ServerConfigurationResult{Values=values,OriginalValues=BuildOriginalSnapshot(values.Keys),BackupPath=backup,TurnServiceChanged=changed.Any(k=>TurnServiceKeys.Contains(k)),AnyChanged=true};DialogResult=DialogResult.OK;Close();}catch(Exception ex){validationLabel.Text="No fue posible guardar: "+ex.Message;validationLabel.ForeColor=Color.FromArgb(244,139,139);}}
  Dictionary<string,string> BuildOriginalSnapshot(IEnumerable<string> keys){var copy=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(var key in keys)copy[key]=ReadValue(key);return copy;}
  string WriteEnvironment(Dictionary<string,string> values){var backupDir=Path.Combine(installPath,"updates","config-backups");Directory.CreateDirectory(backupDir);var backup=Path.Combine(backupDir,"env-production-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".bak");File.Copy(envPath,backup,true);var output=new List<string>();var written=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(var line in originalLines){int split=line.IndexOf('=');var key=split>0?line.Substring(0,split).Trim():"";if(split>0&&values.ContainsKey(key)){if(written.Add(key))output.Add(key+"="+values[key]);}else output.Add(line);}foreach(var pair in values)if(written.Add(pair.Key))output.Add(pair.Key+"="+pair.Value);var temporary=envPath+"."+Guid.NewGuid().ToString("N")+".tmp";File.WriteAllLines(temporary,output,new UTF8Encoding(false));try{File.Replace(temporary,envPath,null);}catch{File.Copy(temporary,envPath,true);File.Delete(temporary);}return backup;}

  bool ValidateValues(Dictionary<string,string> v,out string error){error=null;if(v["ENABLE_HTTP"]!="true"&&v["ENABLE_HTTPS"]!="true"){error="Debe permanecer habilitado al menos HTTP o HTTPS para administrar SAS.";return false;}if(String.IsNullOrWhiteSpace(v["DATA_FILE_PATH"])||String.IsNullOrWhiteSpace(v["BACKUP_DIR"])){error="Las rutas de datos y respaldos no pueden quedar vacías.";return false;}Uri publicUri;if(!TryHttpUri(v["PUBLIC_BASE_URL"],out publicUri)){error="La URL pública debe comenzar con http:// o https:// y contener un host válido.";return false;}if(v["ENABLE_HTTPS"]=="true"&&!publicUri.Scheme.Equals("https",StringComparison.OrdinalIgnoreCase)){error="Con HTTPS habilitado, la URL pública también debe utilizar https://.";return false;}Uri updateUri,healthUri;if(!TryHttpUri(v["UPDATE_BASE_URL"],out updateUri)||!TryHttpUri(v["UPDATE_HEALTH_URL"],out healthUri)){error="Las URLs de actualizaciones y salud deben ser direcciones HTTP/HTTPS válidas.";return false;}if(Uri.CheckHostName(v["SAS_TURN_PUBLIC_HOST"])==UriHostNameType.Unknown){error="El nombre DNS de TURN no es válido.";return false;}foreach(var stun in v["WEBRTC_STUN_URLS"].Split(new[]{','},StringSplitOptions.RemoveEmptyEntries)){if(!Regex.IsMatch(stun.Trim(),@"^stuns?:[A-Za-z0-9.\-\[\]:]+$",RegexOptions.IgnoreCase)){error="Servidor STUN no válido: "+stun.Trim();return false;}}
    int http,https,turn,turnTls,relayMin,relayMax;if(!Number(v,"HTTP_PORT",1,65535,out http,out error)||!Number(v,"HTTPS_PORT",1,65535,out https,out error)||!Number(v,"SAS_TURN_LISTENING_PORT",1,65535,out turn,out error)||!Number(v,"SAS_TURN_TLS_PORT",1,65535,out turnTls,out error)||!Number(v,"WEBRTC_UDP_MIN_PORT",1024,65535,out relayMin,out error)||!Number(v,"WEBRTC_UDP_MAX_PORT",1024,65535,out relayMax,out error))return false;if(http==https||turn==turnTls||new[]{http,https,turn,turnTls}.Distinct().Count()!=4){error="HTTP, HTTPS, TURN y TURN TLS deben usar puertos distintos.";return false;}if(relayMin>relayMax){error="El primer puerto relay no puede ser mayor que el último.";return false;}if(relayMax-relayMin>2048){error="El rango relay no puede superar 2049 puertos.";return false;}if(new[]{http,https,turn,turnTls}.Any(p=>p>=relayMin&&p<=relayMax)){error="El rango relay no puede incluir los puertos HTTP, HTTPS o TURN.";return false;}
    int ignored;if(!Number(v,"WEBRTC_TURN_CREDENTIAL_TTL_SECONDS",60,86400,out ignored,out error)||!Number(v,"SAS_TURN_IP_REFRESH_SECONDS",15,3600,out ignored,out error)||!Number(v,"AGENT_HEARTBEAT_SECONDS",1,3600,out ignored,out error)||!Number(v,"REMOTE_SESSION_TTL_MINUTES",5,1440,out ignored,out error)||!Number(v,"CLIENT_ENROLLMENT_TTL_MINUTES",10,1440,out ignored,out error)||!Number(v,"MOBILE_ACCESS_TTL_MINUTES",1,1440,out ignored,out error)||!Number(v,"SHORT_URL_TIMEOUT_MS",500,30000,out ignored,out error)||!Number(v,"UPDATE_TIMEOUT_MS",1000,60000,out ignored,out error)||!Number(v,"UPDATE_CHECK_INTERVAL_MINUTES",15,10080,out ignored,out error)||!Number(v,"UPDATE_DOWNLOAD_TIMEOUT_MS",10000,600000,out ignored,out error))return false;
    if(v.Values.Any(x=>x.IndexOf('\r')>=0||x.IndexOf('\n')>=0)){error="Los valores no pueden contener saltos de línea.";return false;}if(v["ENABLE_HTTPS"]=="true"){if(!ConfiguredFileExists(v["TLS_CERT_PATH"])||!ConfiguredFileExists(v["TLS_KEY_PATH"])){error="No se encontraron el certificado o la llave TLS en las rutas indicadas.";return false;}}return true;}
  bool Number(Dictionary<string,string> values,string key,int min,int max,out int parsed,out string error){if(!Int32.TryParse(values[key],out parsed)||parsed<min||parsed>max){error=key+" debe estar entre "+min+" y "+max+".";return false;}error=null;return true;}
  bool ConfiguredFileExists(string value){var candidate=Path.IsPathRooted(value)?value:Path.Combine(installPath,value.Replace('/',Path.DirectorySeparatorChar));return File.Exists(candidate);}
  static bool TryHttpUri(string value,out Uri uri){return Uri.TryCreate(value,UriKind.Absolute,out uri)&&(uri.Scheme==Uri.UriSchemeHttp||uri.Scheme==Uri.UriSchemeHttps)&&!String.IsNullOrWhiteSpace(uri.Host);}
}
