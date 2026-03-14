const FIXED_USERNAME = "meandme";
const FIXED_PASSWORD = "nubKos-viwtan-1xyjte";

const MAX_STORAGE_NUMBER = 500;

const SESSION_KEY = "paketlager_session_v10";
const STORAGE_KEY = "paketlager_packages_v10";

const AUTO_LOGOUT_MS = 15 * 60 * 1000;



/* ================================
   AUDIO SYSTEM
================================ */

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function tone(freq = 800, duration = 120, type = "sine", volume = 0.2, delay = 0) {
  try {

    const ctx = ensureAudio();
    const now = ctx.currentTime + delay / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration / 1000 + 0.02);

  } catch(e){}
}

function barcodeSound(){
  tone(1200,70,"square",0.18,0)
  tone(1600,70,"square",0.18,100)
}

function ocrSound(){
  tone(900,120,"triangle",0.18)
}

function successSound(){
  tone(700,140,"sine",0.2)
}

function errorSound(){
  tone(520,140,"sawtooth",0.2,0)
  tone(390,160,"sawtooth",0.22,120)
  tone(260,220,"sawtooth",0.24,260)
}



/* ================================
   ELEMENTS
================================ */

const els = {

loginScreen:document.getElementById("loginScreen"),
appScreen:document.getElementById("appScreen"),

username:document.getElementById("username"),
password:document.getElementById("password"),

loginBtn:document.getElementById("loginBtn"),
loginMsg:document.getElementById("loginMsg"),

logoutBtn:document.getElementById("logoutBtn"),

tabs:document.querySelectorAll(".tab-btn"),
panels:document.querySelectorAll(".tab-panel"),

statUsed:document.getElementById("statUsed"),
statFree:document.getElementById("statFree"),

scanAddressBtn:document.getElementById("scanAddressBtn"),
packageImageInput:document.getElementById("packageImageInput"),

startBarcodeBtn:document.getElementById("startBarcodeBtn"),
stopBarcodeBtn:document.getElementById("stopBarcodeBtn"),
scannerWrap:document.getElementById("scannerWrap"),

trackingNumber:document.getElementById("trackingNumber"),
ocrText:document.getElementById("ocrText"),

firstName:document.getElementById("firstName"),
lastName:document.getElementById("lastName"),

street:document.getElementById("street"),
houseNumber:document.getElementById("houseNumber"),

postalCode:document.getElementById("postalCode"),
city:document.getElementById("city"),

storageNumber:document.getElementById("storageNumber"),

notes:document.getElementById("notes"),

saveBtn:document.getElementById("saveBtn"),
printBtn:document.getElementById("printBtn"),
clearBtn:document.getElementById("clearBtn"),

acceptStatus:document.getElementById("acceptStatus"),

results:document.getElementById("results"),

statusStorage:document.getElementById("statusStorage"),
statusBarcode:document.getElementById("statusBarcode"),
statusAddress:document.getElementById("statusAddress"),
statusReady:document.getElementById("statusReady")

};



/* ================================
   STATE
================================ */

let packages=[]
let logoutTimer=null
let html5Qr=null
let scannerRunning=false



/* ================================
   STORAGE
================================ */

function savePackages(){
localStorage.setItem(STORAGE_KEY,JSON.stringify(packages))
}

function loadPackages(){

const raw=localStorage.getItem(STORAGE_KEY)

if(!raw){
packages=[]
return
}

try{
packages=JSON.parse(raw)||[]
}catch{
packages=[]
}

}



/* ================================
   SESSION
================================ */

function setSession(){
sessionStorage.setItem(SESSION_KEY,"1")
}

function isSession(){
return sessionStorage.getItem(SESSION_KEY)==="1"
}

function clearSession(){
sessionStorage.removeItem(SESSION_KEY)
}



/* ================================
   LOGIN
================================ */

function login(){

if(
els.username.value.trim()===FIXED_USERNAME &&
els.password.value===FIXED_PASSWORD
){

setSession()

els.password.value=""

showApp()

resetLogout()

els.loginMsg.textContent="Login erfolgreich"

}else{

errorSound()

els.loginMsg.textContent="Login falsch"

}

}



function logout(){

clearSession()

showLogin()

}



/* ================================
   UI
================================ */

function showLogin(){
els.loginScreen.classList.remove("hidden")
els.appScreen.classList.add("hidden")
}

function showApp(){
els.loginScreen.classList.add("hidden")
els.appScreen.classList.remove("hidden")
}



function switchTab(name){

els.tabs.forEach(b=>{
b.classList.toggle("active",b.dataset.tab===name)
})

els.panels.forEach(p=>{
p.classList.toggle("hidden",p.id!=="tab-"+name)
})

}



/* ================================
   AUTO LOGOUT
================================ */

function resetLogout(){

clearTimeout(logoutTimer)

logoutTimer=setTimeout(()=>{

logout()

},AUTO_LOGOUT_MS)

}



/* ================================
   STORAGE NUMBERS
================================ */

function getActivePackages(){
return packages.filter(p=>p.status!=="collected")
}

function getNextFreeStorage(){

const used=new Set(
getActivePackages().map(p=>p.storageNumber)
)

for(let i=1;i<=MAX_STORAGE_NUMBER;i++){

if(!used.has(i))return i

}

return null

}



/* ================================
   STATUS DISPLAY
================================ */

function setPill(el,text,type){

el.textContent=text

el.classList.remove("ok","warn","bad")

el.classList.add(type)

}



function updateCompletion(){

const storage=!!els.storageNumber.value
const barcode=!!els.trackingNumber.value

const addr=[
els.firstName.value,
els.lastName.value,
els.street.value,
els.houseNumber.value,
els.postalCode.value,
els.city.value
].filter(v=>v).length

const ready=storage && (barcode || addr>0)

setPill(
els.statusStorage,
storage?"Lagernummer "+els.storageNumber.value:"Lagernummer fehlt",
storage?"ok":"bad"
)

setPill(
els.statusBarcode,
barcode?"Barcode erkannt":"Barcode fehlt",
barcode?"ok":"warn"
)

if(addr>=4){
setPill(els.statusAddress,"Adresse erkannt","ok")
}else if(addr>0){
setPill(els.statusAddress,"Adresse teilweise","warn")
}else{
setPill(els.statusAddress,"Adresse fehlt","bad")
}

setPill(
els.statusReady,
ready?"Speicherbereit":"Nicht speicherbereit",
ready?"ok":"bad"
)

}



/* ================================
   SAVE PACKAGE
================================ */

function savePackage(){

try{

const storage=Number(els.storageNumber.value)||getNextFreeStorage()

const pkg={

id:crypto.randomUUID(),

trackingNumber:els.trackingNumber.value,
firstName:els.firstName.value,
lastName:els.lastName.value,

street:els.street.value,
houseNumber:els.houseNumber.value,

postalCode:els.postalCode.value,
city:els.city.value,

storageNumber:storage,

notes:els.notes.value,

status:"stored",

created:new Date().toISOString()

}

packages.push(pkg)

savePackages()

successSound()

prepareNext()

renderStats()

els.acceptStatus.textContent="Paket gespeichert (Nr "+storage+")"

}catch(e){

errorSound()

els.acceptStatus.textContent="Fehler beim Speichern"

}

}



/* ================================
   RESET FORM
================================ */

function prepareNext(){

els.trackingNumber.value=""
els.ocrText.value=""

els.firstName.value=""
els.lastName.value=""

els.street.value=""
els.houseNumber.value=""

els.postalCode.value=""
els.city.value=""

els.notes.value=""

els.storageNumber.value=getNextFreeStorage()

updateCompletion()

}



/* ================================
   OCR
================================ */

async function processImage(file){

els.acceptStatus.textContent="OCR läuft..."

try{

const res=await Tesseract.recognize(file,"deu+eng")

const txt=res.data.text

els.ocrText.value=txt

parseAddress(txt)

ocrSound()

}catch{

errorSound()

}

updateCompletion()

}



/* ================================
   SIMPLE ADDRESS PARSER
================================ */

function parseAddress(text){

const lines=text.split("\n").map(l=>l.trim()).filter(Boolean)

lines.forEach(l=>{

if(/\d{5}/.test(l)){

const parts=l.split(" ")

els.postalCode.value=parts[0]
els.city.value=parts.slice(1).join(" ")

}

if(/\d+$/.test(l) && !els.houseNumber.value){

const p=l.split(" ")
els.street.value=p.slice(0,-1).join(" ")
els.houseNumber.value=p[p.length-1]

}

})

}



/* ================================
   BARCODE
================================ */

async function startBarcode(){

html5Qr=new Html5Qrcode("barcodeScanner")

els.scannerWrap.classList.remove("hidden")

await html5Qr.start(
{facingMode:"environment"},
{fps:10,qrbox:250},

txt=>{

els.trackingNumber.value=txt

barcodeSound()

updateCompletion()

stopBarcode()

}

)

scannerRunning=true

}

async function stopBarcode(){

if(!scannerRunning)return

await html5Qr.stop()

scannerRunning=false

els.scannerWrap.classList.add("hidden")

}



/* ================================
   STATS
================================ */

function renderStats(){

const used=getActivePackages().length

els.statUsed.textContent=used
els.statFree.textContent=MAX_STORAGE_NUMBER-used

}



/* ================================
   EVENTS
================================ */

function bind(){

els.loginBtn.onclick=login

els.logoutBtn.onclick=logout

els.tabs.forEach(b=>{
b.onclick=()=>switchTab(b.dataset.tab)
})

els.scanAddressBtn.onclick=()=>els.packageImageInput.click()

els.packageImageInput.onchange=e=>{

const f=e.target.files[0]

if(f)processImage(f)

}

els.startBarcodeBtn.onclick=startBarcode
els.stopBarcodeBtn.onclick=stopBarcode

els.saveBtn.onclick=savePackage

els.clearBtn.onclick=prepareNext

[
els.trackingNumber,
els.firstName,
els.lastName,
els.street,
els.houseNumber,
els.postalCode,
els.city
].forEach(el=>{

el.oninput=updateCompletion

})

}



/* ================================
   INIT
================================ */

function init(){

bind()

loadPackages()

if(isSession()){
showApp()
}else{
showLogin()
}

prepareNext()

renderStats()

}

init()
