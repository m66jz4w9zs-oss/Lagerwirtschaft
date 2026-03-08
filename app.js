const USER="meandme"
const PASS="nubKos-viwtan-1xyjte"

let db=[]
let session=false
let timer=null

const els={}

document.querySelectorAll("input,textarea,button,div").forEach(e=>{
if(e.id) els[e.id]=e
})

function login(){

if(
els.authUsername.value===USER &&
els.authPassword.value===PASS
){
session=true
document.body.classList.remove("locked")
resetTimer()
}
else{
els.authStatus.textContent="Login falsch"
}

}

els.authLoginBtn.onclick=login


function resetTimer(){

clearTimeout(timer)

timer=setTimeout(()=>{
logout()
},15*60*1000)

}

function logout(){
session=false
document.body.classList.add("locked")
}

els.logoutBtn.onclick=logout



document.querySelectorAll(".tab-btn").forEach(btn=>{
btn.onclick=()=>{
document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"))
btn.classList.add("active")

const tab=btn.dataset.tab

document.querySelectorAll(".tab-panel").forEach(p=>p.classList.add("hidden"))

document.getElementById("tab-"+tab).classList.remove("hidden")
}
})


els.newPackageBtn.onclick=()=>{
els.packageImageInput.click()
}



els.packageImageInput.onchange=async e=>{

const file=e.target.files[0]

if(!file)return

els.acceptStatus.textContent="OCR läuft..."

const result=await Tesseract.recognize(file,"deu")

els.ocrText.value=result.data.text

parseAddress(result.data.text)

assignStorage()

}



function parseAddress(text){

const lines=text.split("\n")

for(const l of lines){

if(/\d{5}/.test(l)){

const m=l.match(/(\d{5}) (.*)/)

if(m){
els.postalCode.value=m[1]
els.city.value=m[2]
}

}

if(/straße|strasse|weg/i.test(l)){

const m=l.match(/(.*) (\d+)/)

if(m){
els.street.value=m[1]
els.houseNumber.value=m[2]
}

}

if(/^[A-Za-z ]+$/.test(l) && l.split(" ").length>=2){

const p=l.split(" ")

els.firstName.value=p[0]
els.lastName.value=p.slice(1).join(" ")

}

}

}



function assignStorage(){

for(let i=1;i<=500;i++){

if(!db.find(p=>p.storage==i && !p.collected)){

els.storageNumber.value=i
return

}

}

alert("Keine Lagernummer frei")

}



els.saveBtn.onclick=()=>{

const pkg={

id:Date.now(),

first:els.firstName.value,
last:els.lastName.value,

street:els.street.value,
house:els.houseNumber.value,

plz:els.postalCode.value,
city:els.city.value,

storage:Number(els.storageNumber.value),

notes:els.notes.value,

collected:false

}

db.push(pkg)

render()

}



function render(){

const q=els.searchInput.value?.toLowerCase()||""

const list=db.filter(p=>{

return(
!q ||
p.first.toLowerCase().includes(q) ||
p.last.toLowerCase().includes(q) ||
p.storage==q
)

})

els.results.innerHTML=list.map(p=>`

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

render()

}



els.searchBtn.onclick=render
els.showAllBtn.onclick=render



els.printBtn.onclick=()=>{

const zpl=`

^XA
^CF0,120
^FO50,50^FD${els.storageNumber.value}^FS
^CF0,60
^FO50,220^FD${els.houseNumber.value}^FS
^CF0,50
^FO50,300^FD${els.firstName.value} ${els.lastName.value}^FS
^XZ

`

console.log(zpl)

alert("ZPL im Console Log")

}
