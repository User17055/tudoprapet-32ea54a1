import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, unlink, copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { isOriginAllowed } from "./origin.mjs";

const here=dirname(fileURLToPath(import.meta.url)), configPath=join(here,"config.json"), statePath=join(here,"state.json");
try{await access(configPath,constants.R_OK)}catch{await copyFile(join(here,"config.example.json"),configPath)}
const config=JSON.parse((await readFile(configPath,"utf8")).replace(/^\uFEFF/,""));
const dashboardTemplate=await readFile(join(here,"dashboard.html"),"utf8");
const logoGfa=await readFile(join(here,"logo-gfa.txt"),"ascii");
let state=await readFile(statePath,"utf8").then(text=>JSON.parse(text.replace(/^\uFEFF/,""))).catch(()=>({printedOrderIds:[],baselineComplete:false}));
state.printedOrderIds=Array.isArray(state.printedOrderIds)?state.printedOrderIds:[];
state.printedJobIds=Array.isArray(state.printedJobIds)?state.printedJobIds:[];
state.history=Array.isArray(state.history)?state.history:[];
let lastError=null,lastPrintAt=null,polling=false,pollingJobs=false;
const saveState=async()=>{state.printedOrderIds=state.printedOrderIds.slice(-2000);state.printedJobIds=state.printedJobIds.slice(-2000);state.history=state.history.slice(0,50);await writeFile(statePath,JSON.stringify(state,null,2))};
const recordHistory=async(entry)=>{state.history.unshift({at:new Date().toISOString(),...entry});await saveState()};

function sendRaw(zpl){if(!String(config.printerName||"").trim())return Promise.reject(new Error("Impressora nao configurada. Execute INSTALAR.cmd e escolha a Zebra."));return new Promise(async(resolve,reject)=>{const temp=join(tmpdir(),`tpp-${randomUUID()}.zpl`);await writeFile(temp,zpl,"ascii");const child=spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",join(here,"print-raw.ps1"),"-PrinterName",config.printerName,"-FilePath",temp],{windowsHide:true});let err="";child.stderr.on("data",c=>err+=c);child.on("error",reject);child.on("close",async code=>{await unlink(temp).catch(()=>{});if(code===0){lastPrintAt=new Date().toISOString();lastError=null;resolve()}else{lastError=err.trim()||`PowerShell terminou com código ${code}`;reject(new Error(lastError))}})})}
const clean=(v,max=50)=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[\^~]/g," ").replace(/[^\x20-\x7e]/g," ").slice(0,max);
const brl=v=>`R$ ${Number(v||0).toFixed(2).replace(".",",")}`;
function orderToZpl(o){
  const allItems=o.line_items||[],itemsPerLabel=5;
  const pages=allItems.length?Array.from({length:Math.ceil(allItems.length/itemsPerLabel)},(_,index)=>allItems.slice(index*itemsPerLabel,(index+1)*itemsPerLabel)):[[]];
  const delivery=clean(o.delivery_label||o.shipping_method||"ENVIO",18).toUpperCase();
  const barcode=String(o.id||o.name).replace(/\D/g,"").slice(-20)||"0";
  return pages.map((pageItems,pageIndex)=>{
    let y=755;
    const items=pageItems.map((item,index)=>{if(index>0)y+=58;const label=`${item.quantity}x ${item.title}${item.variant_title?` - ${item.variant_title}`:""}`;return `^FO25,${y}^A0N,24,24^FB540,2,2,L^FD${clean(label,85)}^FS\n^FO575,${y}^A0N,24,24^FB200,1,0,R^FD${clean(brl(item.price*item.quantity),20)}^FS`}).join("\n")||"^FO25,755^A0N,24,24^FDNenhum item informado^FS";
    const totalY=y+82,pageNumber=pageIndex+1,pageCount=pages.length,itemStart=pageIndex*itemsPerLabel+1,itemEnd=itemStart+pageItems.length-1;
    const pageDescription=pageCount>1?`ITENS ${itemStart}-${itemEnd} DE ${allItems.length} - PARTE ${pageNumber}/${pageCount}`:"ITENS DO PEDIDO";
    return `^XA
^CI28
^FX TPP-ZPL-V3
^PW800
^LL1200
^FO160,20${logoGfa.trim()}^FS
^FO25,120^GB750,4,4^FS
^FO25,145^GB750,90,90^FS
^FO25,158^A0N,68,68^FB750,1,0,C^FR^FD${delivery}^FS
^FO25,255^A0N,30,30^FDPEDIDO ${clean(o.name,24)}^FS
^FO545,255^A0N,24,24^FB230,1,0,R^FDPARTE ${pageNumber}/${pageCount}^FS
^FO25,295^A0N,22,22^FDMETODO: ${clean(o.shipping_method||delivery,48)}^FS
^FO175,335^BY3,,0^BCN,120,Y,N,N^FD${barcode}^FS
^FO25,505^GB750,3,3^FS
^FO25,525^A0N,24,24^FDDESTINATARIO^FS
^FO25,560^A0N,31,31^FB730,2,5,L^FD${clean(o.customer_name,60)}^FS
^FO25,640^A0N,22,22^FB730,3,5,L^FD${delivery==="RETIRADA"?"RETIRAR NA LOJA TUDOPRAPET":clean(o.address||"Nao informado",100)}^FS
^FO25,715^A0N,20,20^FD${pageDescription}^FS
^FO25,742^GB750,2,2^FS
${items}
^FO25,${totalY}^GB750,2,2^FS
^FO25,${totalY+25}^A0N,32,32^FDTotal do pedido^FS
^FO500,${totalY+25}^A0N,32,32^FB275,1,0,R^FD${clean(brl(o.total_price),22)}^FS
^FO25,${totalY+75}^A0N,20,20^FDPAGAMENTO: ${clean(o.financial_status,25)}^FS
^XZ`}).join("\n");
}

async function fetchLabelOrders(){
  const since=new Date(Date.now()-30*86400000).toISOString();
  const data=await agentPost({action:"list",since,limit:200});
  return data.orders||[];
}

async function fetchLabelOrder(orderId){
  const data=await agentPost({action:"print_order",orderId:String(orderId)});
  if(!data.order||!Array.isArray(data.order.line_items)||data.order.line_items.length===0){
    throw new Error("O pedido ainda nao esta completo na Shopify. Aguarde alguns segundos e tente novamente.");
  }
  return data.order;
}

function invoiceLabelZpl(invoice,order){
  const delivery=clean(order.delivery_label||order.shipping_method||"ENVIO",18).toUpperCase();
  const orderNumber=clean(order.name||order.id,24);
  const accessKey=String(invoice.accessKey||"").replace(/\D/g,"").slice(0,44);
  const invoiceNumber=clean(invoice.number||"Nao informado",20);
  const series=clean(invoice.series||"-",8);
  const recipient=clean(invoice.recipientName||order.customer_name||"Cliente",55);
  const recipientDoc=clean(invoice.recipientDoc||"",24);
  const address=clean(invoice.address||order.address||"Nao informado",95);
  const cityLine=clean([invoice.city,invoice.state,invoice.zip].filter(Boolean).join(" - "),70);
  const emitter=clean(invoice.emitterName||"TudoPraPet",55);
  const emitterDoc=clean(invoice.emitterCnpj||"",22);
  const issueDate=clean(invoice.issueDate||"",24);
  const protocol=clean(invoice.protocol||"",35);
  const orderBarcode=String(order.id||order.name||"").replace(/\D/g,"").slice(-20)||"0";
  const pickup=delivery==="RETIRADA";
  const destinationText=pickup?"RETIRAR NA LOJA TUDOPRAPET":address;
  return `^XA
^CI28
^PW800
^LL1200
^FO160,20${logoGfa}^FS
^FO25,120^GB750,4,4^FS
^FO25,145^GB750,90,90^FS
^FO25,158^A0N,68,68^FB750,1,0,C^FR^FD${delivery}^FS
^FO25,255^A0N,28,28^FDPEDIDO ${orderNumber}^FS
^FO25,292^A0N,22,22^FDMETODO: ${clean(order.shipping_method||delivery,45)}^FS
^FO155,335^BY3,,0^BCN,135,Y,N,N^FD${orderBarcode}^FS
^FO25,520^GB750,3,3^FS
^FO25,540^A0N,25,25^FDDESTINATARIO^FS
^FO25,575^A0N,34,34^FB720,2,4,L^FD${recipient}^FS
^FO25,655^A0N,25,25^FB720,3,4,L^FD${destinationText}^FS
^FO25,755^A0N,25,25^FB720,2,4,L^FD${cityLine}^FS
^FO25,825^A0N,22,22^FDDOCUMENTO: ${recipientDoc||"Nao informado"}^FS
^FO25,865^GB750,3,3^FS
^FO25,890^A0N,28,28^FDNF: ${invoiceNumber}  SERIE: ${series}^FS
^FO25,935^A0N,22,22^FB720,2,3,L^FDCHAVE: ${accessKey||"Nao informada"}^FS
^FO610,990^BQN,2,5^FDLA,${clean(order.name||order.id,30)}^FS
^FO25,1075^A0N,22,22^FD${pickup?"PEDIDO PARA RETIRADA":"VOLUME PARA ENTREGA"}^FS
^XZ
^XA
^CI28
^PW800
^LL1200
^FO160,20${logoGfa}^FS
^FO25,120^GB750,3,3^FS
^FO25,145^A0N,36,36^FDDANFE SIMPLIFICADO^FS
^FO25,200^A0N,24,24^FDNF: ${invoiceNumber}  SERIE: ${series}  EMISSAO: ${issueDate}^FS
^FO25,245^A0N,22,22^FDCHAVE DE ACESSO^FS
^FO55,280^BY2,,0^BCN,120,Y,N,N^FD${accessKey||orderBarcode}^FS
^FO25,455^GB750,2,2^FS
^FO25,480^A0N,22,22^FDREMETENTE: ${emitter}^FS
^FO25,515^A0N,22,22^FDCNPJ: ${emitterDoc||"Nao informado"}^FS
^FO25,565^GB750,2,2^FS
^FO25,590^A0N,22,22^FDDESTINATARIO: ${recipient}^FS
^FO25,625^A0N,22,22^FDDOCUMENTO: ${recipientDoc||"Nao informado"}^FS
^FO25,660^A0N,22,22^FB720,3,4,L^FDENDERECO: ${address}^FS
^FO25,755^A0N,22,22^FB720,2,4,L^FD${cityLine}^FS
^FO25,825^GB750,2,2^FS
^FO25,850^A0N,22,22^FDPROTOCOLO DE AUTORIZACAO^FS
^FO25,885^A0N,22,22^FD${protocol||"Nao informado"}^FS
^FO25,955^A0N,22,22^FB720,5,4,L^FDDADOS ADICIONAIS: ${clean(invoice.additionalInfo||"",180)}^FS
^XZ`;
}

async function pollOrders(){if(polling||!config.autoPrint)return;if(!config.printAgentToken||config.printAgentToken.startsWith("COLOQUE_")){lastError="PRINT_AGENT_TOKEN ainda não configurado";return}polling=true;try{const fallbackSince=new Date(Date.now()-86400000).toISOString();const checkpoint=state.lastPollAt||state.activatedAt||fallbackSince;const since=new Date(new Date(checkpoint).getTime()-120000).toISOString();const url=`${config.supabaseUrl.replace(/\/$/,"")}/functions/v1/admin-orders?since=${encodeURIComponent(since)}&limit=1000`;const response=await fetch(url,{headers:{"x-print-agent-token":config.printAgentToken}});if(!response.ok)throw new Error(`Consulta de pedidos: HTTP ${response.status} ${await response.text()}`);const data=await response.json();const orders=data.orders||[];
  // Primeira conexão: cria uma linha de corte e registra tudo que já existe sem imprimir.
  // Isso impede que a instalação dispare o histórico inteiro na Zebra.
  if(state.baselineComplete!==true){state.printedOrderIds=[...new Set([...state.printedOrderIds,...orders.map(o=>String(o.id))])];state.activatedAt=data.server_time||new Date().toISOString();state.lastPollAt=state.activatedAt;state.baselineComplete=true;await saveState();lastError=null;return}
  const activatedAt=new Date(state.activatedAt).getTime();
  const pending=orders.filter(o=>new Date(o.created_at).getTime()>activatedAt&&!state.printedOrderIds.includes(String(o.id))).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  for(const order of pending){
    try{
      const freshOrder=await fetchLabelOrder(order.id);
      await sendRaw(orderToZpl(freshOrder));
      state.printedOrderIds.push(String(freshOrder.id));
      await recordHistory({orderId:String(freshOrder.id),orderName:freshOrder.name||String(freshOrder.id),source:"automatic",status:"printed"});
    }catch(error){
      await recordHistory({orderId:String(order.id),orderName:order.name||String(order.id),source:"automatic",status:"error",error:error instanceof Error?error.message:String(error)});
      throw error;
    }
  }
  state.lastPollAt=data.server_time||new Date().toISOString();await saveState();lastError=null
  }catch(e){lastError=e instanceof Error?e.message:String(e)}finally{polling=false}
}
async function agentPost(body){
  const response=await fetch(`${config.supabaseUrl.replace(/\/$/,"")}/functions/v1/admin-orders`,{method:"POST",headers:{"content-type":"application/json","x-print-agent-token":config.printAgentToken},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`Fila de impressão: HTTP ${response.status} ${await response.text()}`);
  const data=await response.json();
  data.functionsVersion=response.headers.get("x-tpp-functions-version")||"não informada";
  return data;
}
async function pollPrintJobs(){
  if(pollingJobs||!config.printAgentToken||config.printAgentToken.startsWith("COLOQUE_"))return;
  pollingJobs=true;
  try{
    const data=await agentPost({action:"print_jobs"});
    if(!Array.isArray(data.jobs))throw new Error(`A função admin-orders publicada está desatualizada (versão ${data.functionsVersion}). Publique a versão 2026-08-10.6.`);
    for(const job of data.jobs||[]){
      if(state.printedJobIds.includes(String(job.id))){
        const confirmation=await agentPost({action:"ack_print",jobId:job.id,status:"printed"});
        if(confirmation.ok!==true)throw new Error(`A nuvem recebeu o retorno, mas não confirmou o pedido ${job.order_name||job.id}. Atualize a função admin-orders.`);
        continue;
      }
      try{
        // A fila pode ter sido criada por uma versao antiga do site, com ZPL
        // de uma unica pagina. O agente sempre remonta a etiqueta localmente
        // para aplicar a paginacao atual antes de enviar para a Zebra.
        const freshOrder=await fetchLabelOrder(job.order_id);
        await sendRaw(orderToZpl(freshOrder));
      }catch(error){
        await recordHistory({jobId:String(job.id),orderName:job.order_name||job.order_id||"Pedido",source:"manual",status:"error",error:error instanceof Error?error.message:String(error)});
        await agentPost({action:"ack_print",jobId:job.id,status:"error",error:error instanceof Error?error.message:String(error)}).catch(()=>{});
        throw error;
      }
      // Salva antes de confirmar na nuvem. Se a internet cair neste ponto,
      // a próxima tentativa apenas confirma, sem imprimir outra etiqueta.
      state.printedJobIds.push(String(job.id));
      await recordHistory({jobId:String(job.id),orderName:job.order_name||job.order_id||"Pedido",source:"manual",status:"printed"});
      const confirmation=await agentPost({action:"ack_print",jobId:job.id,status:"printed"});
      if(confirmation.ok!==true)throw new Error(`A nuvem recebeu o retorno, mas não confirmou o pedido ${job.order_name||job.id}. Atualize a função admin-orders.`);
    }
    lastError=null;
  }catch(error){lastError=error instanceof Error?error.message:String(error)}
  finally{pollingJobs=false}
}
async function pollCycle(){await pollPrintJobs();await pollOrders()}
function allowed(req){return isOriginAllowed(req.headers.origin,config)}
function reply(res,status,body,origin){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Private-Network":"true","Vary":"Origin"});res.end(JSON.stringify(body))}
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
function dashboardHtml(){
  const rows=state.history.map(item=>`<tr><td><strong>${escapeHtml(item.orderName)}</strong></td><td>${item.source==="automatic"?"Automático":"Botão imprimir"}</td><td>${new Date(item.at).toLocaleString("pt-BR")}</td><td><span class="status ${item.status}">${item.status==="printed"?"Impresso":"Falhou"}</span>${item.error?`<small>${escapeHtml(item.error)}</small>`:""}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TudoPraPet Impressão</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#14213d;font:14px Arial,sans-serif}.top{background:#112f5f;color:#fff;padding:22px 5vw;border-bottom:6px solid #e0ad35}.top h1{margin:0;font-size:25px}.top p{margin:6px 0 0;color:#dce7f8}.wrap{max-width:1050px;margin:28px auto;padding:0 18px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:20px}.card,.panel{background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:16px;box-shadow:0 4px 16px #10254d12}.label{font-size:12px;color:#667085}.value{margin-top:5px;font-weight:700}.online{color:#16803c}.error-text{color:#b42318}.panel{overflow:auto}.panel h2{margin:0 0 14px}table{width:100%;border-collapse:collapse;min-width:700px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e7eaf0}th{background:#f7f8fa;font-size:12px;color:#667085}.status{display:inline-block;border-radius:999px;padding:5px 9px;font-weight:700}.status.printed{background:#e8f7ed;color:#16803c}.status.error{background:#feeceb;color:#b42318}small{display:block;color:#b42318;margin-top:5px}.empty{text-align:center;color:#667085;padding:35px}.foot{text-align:center;color:#778197;margin-top:14px;font-size:12px}</style></head><body><header class="top"><h1>TudoPraPet Impressão</h1><p>Computador receptor da impressora ZPL</p></header><main class="wrap"><section class="cards"><div class="card"><div class="label">Programa</div><div class="value online">● Ligado — versão 1.3.0</div></div><div class="card"><div class="label">Impressora</div><div class="value">${escapeHtml(config.printerName)}</div></div><div class="card"><div class="label">Impressão automática</div><div class="value">${config.autoPrint?"Ativada":"Desativada"}</div></div><div class="card"><div class="label">Último erro</div><div class="value ${lastError?"error-text":"online"}">${escapeHtml(lastError||"Nenhum")}</div></div></section><section class="panel"><h2>Últimos pedidos recebidos</h2>${rows?`<table><thead><tr><th>Pedido</th><th>Origem</th><th>Horário</th><th>Resultado</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="empty">Nenhum pedido recebido ainda.</div>'}</section><div class="foot">Esta tela atualiza automaticamente a cada 5 segundos.</div></main></body></html>`;
}
async function readJson(req,maxBytes=2097152){let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>maxBytes)throw new Error("Arquivo muito grande")}return JSON.parse(raw||"{}")}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(!allowed(req))return reply(res,403,{error:"Origem não autorizada"},"null");
  if(req.method==="OPTIONS")return reply(res,204,{},origin);
  if(req.method==="GET"&&(req.url==="/"||req.url==="/dashboard")){
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
    return res.end(dashboardTemplate);
  }
  if(req.method==="GET"&&req.url==="/history")return reply(res,200,{history:state.history},origin);
  if(req.method==="GET"&&req.url==="/status")return reply(res,200,{ok:true,version:"1.5.5",printer:config.printerName,printerConfigured:Boolean(String(config.printerName||"").trim()),autoPrint:!!config.autoPrint,baselineComplete:state.baselineComplete===true,lastPrintAt,lastError},origin);
  if(req.method==="GET"&&req.url==="/label-orders"){
    try{return reply(res,200,{orders:await fetchLabelOrders()},origin)}
    catch(error){return reply(res,502,{error:error instanceof Error?error.message:"Falha ao carregar pedidos"},origin)}
  }
  if(req.method==="POST"&&req.url==="/order-label"){
    let body,order;
    try{
      body=await readJson(req);
      if(!body.orderId)throw new Error("Selecione um pedido");
      order=await fetchLabelOrder(body.orderId);
      const zpl=orderToZpl(order);
      if(body.print===true){
        await sendRaw(zpl);
        await recordHistory({orderId:String(order.id),orderName:order.name||String(order.id),source:"manual",status:"printed"});
      }
      return reply(res,200,{ok:true,zpl,printed:body.print===true},origin);
    }catch(error){
      if(body?.print===true)await recordHistory({orderId:String(order?.id||body?.orderId||""),orderName:order?.name||String(body?.orderId||"Pedido"),source:"manual",status:"error",error:error instanceof Error?error.message:String(error)}).catch(()=>{});
      return reply(res,400,{error:error instanceof Error?error.message:"Falha ao gerar etiqueta"},origin);
    }
  }
  if(req.method==="POST"&&req.url==="/invoice-label"){
    let body,order;
    try{
      body=await readJson(req);
      if(!body.orderId||!body.invoice||typeof body.invoice!=="object")throw new Error("Selecione o pedido e o XML da nota fiscal");
      order=await fetchLabelOrder(body.orderId);
      const zpl=invoiceLabelZpl(body.invoice,order);
      if(body.print===true){
        await sendRaw(zpl);
        await recordHistory({orderId:String(order.id),orderName:order.name||String(order.id),source:"xml",status:"printed"});
      }
      return reply(res,200,{ok:true,zpl,printed:body.print===true},origin);
    }catch(error){
      if(body?.print===true)await recordHistory({orderId:String(order?.id||body?.orderId||""),orderName:order?.name||String(body?.orderId||"NF-e"),source:"xml",status:"error",error:error instanceof Error?error.message:String(error)}).catch(()=>{});
      return reply(res,400,{error:error instanceof Error?error.message:"Falha ao gerar etiqueta"},origin);
    }
  }
  if(req.method==="POST"&&req.url==="/print"){
    try{
      const body=await readJson(req,1048576);
      if(typeof body.zpl!=="string"||!body.zpl.startsWith("^XA")||!body.zpl.trimEnd().endsWith("^XZ"))throw new Error("Código ZPL inválido");
      await sendRaw(body.zpl);
      return reply(res,200,{ok:true},origin);
    }catch(error){return reply(res,400,{error:error instanceof Error?error.message:"Falha ao imprimir"},origin)}
  }
  if(req.method==="POST"&&req.url==="/test-print"){
    try{
      const zpl=`^XA\n^CI28\n^PW800\n^LL500\n^FO40,45^A0N,48,48^FDTUDOPRAPET^FS\n^FO40,120^A0N,34,34^FDIMPRESSORA CONFIGURADA^FS\n^FO40,185^A0N,26,26^FD${clean(config.printerName,60)}^FS\n^FO40,245^GB720,3,3^FS\n^FO40,280^A0N,24,24^FDTeste realizado em ${clean(new Date().toLocaleString("pt-BR"),35)}^FS\n^XZ`;
      await sendRaw(zpl);
      await recordHistory({orderName:"Teste da impressora",source:"test",status:"printed"});
      return reply(res,200,{ok:true},origin);
    }catch(error){
      const message=error instanceof Error?error.message:"Falha ao testar a impressora";
      await recordHistory({orderName:"Teste da impressora",source:"test",status:"error",error:message}).catch(()=>{});
      return reply(res,400,{error:message},origin);
    }
  }
  return reply(res,404,{error:"Rota não encontrada"},origin);
});
server.listen(Number(config.port||17891),"127.0.0.1",()=>{console.log(`TudoPraPet Impressão ativo em http://127.0.0.1:${config.port||17891}`);console.log(`Impressora: ${config.printerName}`);console.log(`Impressão automática: ${config.autoPrint?"ligada":"desligada"}`)});
setInterval(pollCycle,Math.max(10,Number(config.pollSeconds||20))*1000);setTimeout(pollCycle,1500);
