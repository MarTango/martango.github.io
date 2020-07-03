const sock = io("https://marchat.herokuapp.com/");
const ul = document.querySelector("ul");

sock.on("chatmsg", function (msg) {
  const li = document.createElement("li");
  li.innerText = msg;
  ul.appendChild(li);
  if (ul.childElementCount >= 10) {
    ul.removeChild(ul.firstChild);
  }
});

const msgInput = document.querySelector("input#msg");

document.querySelector("form").addEventListener("submit", function (e) {
  e.preventDefault();
  sock.send(msgInput.value);
  msgInput.value = "";
});
