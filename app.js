const USER="meandme"
const PASS="nubKos-viwtan-1xyjte"

const MAX_STORAGE=500

let db=[]
let logoutTimer=null

const $=id=>document.getElementById(id)

function autoLogout(){

clearTimeout(logoutTimer)

logoutTimer=setTimeout(()=>{
logout()
},900000)

}

function logout(){

$("#loginScreen").style.display="flex"
$("#app").classList.add("hidden")

}

$("#loginBtn").onclick=()=>{

if(
$("#username").value===USER &&
$("#password").value===PASS
){

$("#loginScreen").style.display="none"
$("#app").classList.remove("hidden")

autoLogout()

}
else{
$("#loginMsg").textContent="Login falsch"
}

}

$("#logoutBtn").onclick=logout



function nextStorage(){

for(let i=1;i<=MAX_STORAGE;i++){

if(!db.find(p=>p.storage===i && !p.collected))
return i

}

return null

}



function updateStats(){

const used=db.filter(p=>!p.collected).length

$("#statUsed").textContent=used
$("#statFree").textContent=MAX_STORAGE-used

}



function parseAddress(text){

const lines=text.split("\n")

for(const l of lines){

if(/\d{5}/.test(l)){

const m=l.match(/(\d{5}) (.*)/)

if(m){
$("#postalCode").value=m[1]
$("#city").value=m[2]
}

}

if(/straße|strasse|weg/i.test(l)){

const m=l.match(/(.*) (\d+)/)

if(m){
$("#street").value=m[1]
$("#houseNumber").value=m[2]
}

}

if(/^[A-Za-z ]+$/.test(l) && l.split(" ").length>=2){

const p=l.split(" ")

$("#firstName").value=p[0]
$("#lastName").value=p.slice(1).join(" ")

}

}

}



$("#startScan").onclick=async()=>{

const stream=await navigator.mediaDevices.getUserMedia({
video:{facingMode:"environment"}
})

$("#camera").srcObject=stream

}



async function runOCR(image){

const result=await Tesseract.recognize(image,"deu")

$("#ocrText").value=result.data.text

parseAddress(result.data.text)

$("#storageNumber").value=nextStorage()

}



$("#savePackage").onclick=()=>{

const pkg={

id:Date.now(),

first:$("#firstName").value||"",
last:$("#lastName").value||"",

street:$("#street").value||"",
house:$("#houseNumber").value||"",

plz:$("#postalCode").value||"",
city:$("#city").value||"",

storage:Number($("#storageNumber").value)||nextStorage(),

notes:$("#notes").value||"",

collected:false

}

db.push(pkg)

updateStats()

renderPackages()

}



function renderPackages(){

const q=$("#searchInput").value.toLowerCase()

const list=db.filter(p=>

!q ||
p.first.toLowerCase().includes(q) ||
p.last.toLowerCase().includes(q) ||
String(p.storage)==q
)

$("#packageList").innerHTML=list.map(p=>`

<div class="package">

<b>Lagernummer ${p.storage}</b><br>

${p.first} ${p.last}<br>

${p.street} ${p.house}<br>

${p.plz} ${p.city}

<br><br>

<button onclick="collect(${p.id})">
Abgeholt
</button>

</div>

`).join("")

}



window.collect=id=>{

const p=db.find(x=>x.id==id)

p.collected=true

updateStats()

renderPackages()

}



$("#searchBtn").onclick=renderPackages



$("#printLabel").onclick=()=>{

const zpl=`

^XA
^CF0,120
^FO50,50^FD${$("#storageNumber").value}^FS
^CF0,60
^FO50,200^FD${$("#houseNumber").value}^FS
^CF0,60
^FO50,300^FD${$("#firstName").value} ${$("#lastName").value}^FS
^XZ

`

console.log(zpl)

alert("ZPL im Console Log")

}



$("#clearForm").onclick=()=>{

document.querySelectorAll("input").forEach(i=>{
if(i.id!=="storageNumber")i.value=""
})

$("#storageNumber").value=nextStorage()

}
