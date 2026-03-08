const USER="meandme"
const PASS="nubKos-viwtan-1xyjte"

let db=[]
let session=false
let logoutTimer=null

const $=id=>document.getElementById(id)

function resetTimer(){

clearTimeout(logoutTimer)

logoutTimer=setTimeout(()=>{
logout()
},900000)

}

function logout(){

session=false
$("auth").style.display="flex"
$("app").style.display="none"

}

$("login").onclick=()=>{

if($("user").value===USER && $("pass").value===PASS){

session=true

$("auth").style.display="none"
$("app").style.display="block"

resetTimer()

}
else{
$("loginStatus").textContent="Login falsch"
}

}

$("logout").onclick=logout

function assignStorage(){

for(let i=1;i<=500;i++){

if(!db.find(p=>p.storage===i && !p.collected)){

$("storage").value=i
return

}

}

$("storage").value=""
alert("Lager voll")

}

$("scanBtn").onclick=()=>{

$("imageInput").click()

}

$("imageInput").onchange=async e=>{

const file=e.target.files[0]

if(!file)return

$("ocrText").value="OCR läuft..."

const res=await Tesseract.recognize(file,"deu")

const text=res.data.text

$("ocrText").value=text

parseAddress(text)

assignStorage()

}

function parseAddress(text){

const lines=text.split("\n")

for(const l of lines){

if(/\d{5}/.test(l)){

const m=l.match(/(\d{5}) (.*)/)

if(m){
$("plz").value=m[1]
$("city").value=m[2]
}

}

if(/straße|strasse|weg/i.test(l)){

const m=l.match(/(.*) (\d+)/)

if(m){
$("street").value=m[1]
$("house").value=m[2]
}

}

if(/^[A-Za-z ]+$/.test(l) && l.split(" ").length>=2){

const p=l.split(" ")

$("first").value=p[0]
$("last").value=p.slice(1).join(" ")

}

}

}

$("save").onclick=()=>{

assignStorage()

const pkg={

id:Date.now(),

first:$("first").value||"",
last:$("last").value||"",

street:$("street").value||"",
house:$("house").value||"",

plz:$("plz").value||"",
city:$("city").value||"",

storage:Number($("storage").value)||0,

notes:$("notes").value||"",

collected:false

}

db.push(pkg)

updateStats()

render()

}

function updateStats(){

const used=db.filter(p=>!p.collected).length

$("used").textContent=used
$("free").textContent=500-used

}

function render(){

const q=$("search").value?.toLowerCase()||""

const list=db.filter(p=>{

return(
!q ||
p.first.toLowerCase().includes(q) ||
p.last.toLowerCase().includes(q) ||
String(p.storage)==q
)

})

$("list").innerHTML=list.map(p=>`

<div class="package">

<b>Lagernummer ${p.storage}</b><br>

${p.first} ${p.last}<br>

${p.street} ${p.house}<br>

${p.plz} ${p.city}

<br><br>

<button onclick="collect(${p.id})">Abgeholt</button>

</div>

`).join("")

}

window.collect=id=>{

const p=db.find(x=>x.id==id)

p.collected=true

updateStats()

render()

}

$("searchBtn").onclick=render

$("print").onclick=()=>{

const zpl=`

^XA
^CF0,120
^FO50,50^FD${$("storage").value}^FS
^CF0,60
^FO50,200^FD${$("house").value}^FS
^CF0,60
^FO50,300^FD${$("first").value} ${$("last").value}^FS
^XZ

`

console.log(zpl)

alert("ZPL im Console Log")

}

$("clear").onclick=()=>{

document.querySelectorAll("input,textarea").forEach(e=>{
if(e.id!=="storage")e.value=""
})

assignStorage()

}
