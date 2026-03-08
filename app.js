const USER="meandme"
const PASS="nubKos-viwtan-1xyjte"

let db=[]
let session=false
let timer=null

const $=id=>document.getElementById(id)



$("#authLoginBtn").onclick=()=>{

if(
$("#authUsername").value===USER &&
$("#authPassword").value===PASS
){
session=true
document.body.classList.remove("locked")
resetTimer()
}
else{
$("#authStatus").textContent="Login falsch"
}

}



function resetTimer(){

clearTimeout(timer)

timer=setTimeout(()=>{
logout()
},900000)

}



function logout(){

session=false
document.body.classList.add("locked")

}

$("#logoutBtn").onclick=logout



document.querySelectorAll(".tab").forEach(t=>{

t.onclick=()=>{

document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"))
t.classList.add("active")

document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"))

document.getElementById(t.dataset.data).classList.remove("hidden")

}

})



$("#newPackageBtn").onclick=()=>{
$("#packageImageInput").click()
}



$("#packageImageInput").onchange=async e=>{

const file=e.target.files[0]

$("#acceptStatus").textContent="OCR läuft..."

const result=await Tesseract.recognize(file,"deu")

$("#ocrText").value=result.data.text

parseAddress(result.data.text)

assignStorage()

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

if(/^[A-Za-z ]+$/.test(l)&&l.split(" ").length>=2){

const p=l.split(" ")

$("#firstName").value=p[0]
$("#lastName").value=p.slice(1).join(" ")

}

}

}



function assignStorage(){

for(let i=1;i<=500;i++){

if(!db.find(p=>p.storage==i&&!p.collected)){

$("#storageNumber").value=i
return

}

}

alert("Lager voll")

}



$("#saveBtn").onclick=()=>{

const pkg={

id:Date.now(),

first:$("#firstName").value,
last:$("#lastName").value,

street:$("#street").value,
house:$("#houseNumber").value,

plz:$("#postalCode").value,
city:$("#city").value,

storage:Number($("#storageNumber").value),

notes:$("#notes").value,

collected:false

}

db.push(pkg)

updateStats()

render()

}



function updateStats(){

const used=db.filter(p=>!p.collected).length

$("#statUsed").textContent=used
$("#statFree").textContent=500-used

}



function render(){

const q=$("#searchInput").value?.toLowerCase()||""

const list=db.filter(p=>{

return(
!q ||
p.first.toLowerCase().includes(q) ||
p.last.toLowerCase().includes(q) ||
String(p.storage)==q
)

})

$("#results").innerHTML=list.map(p=>`

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

render()

}



$("#searchBtn").onclick=render



$("#printBtn").onclick=()=>{

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
