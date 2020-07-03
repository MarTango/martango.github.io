# martango.github.io

I'll put something here soon.

<ul>
</ul>

<form action="">
  <input id="msg" type="text" value=""/><button>Send</button>
</form>


<span>
  <script src="//cdnjs.cloudflare.com/ajax/libs/socket.io/2.2.0/socket.io.js"></script>
  <script type="text/javascript">
    const sock = io("https://marchat.herokuapp.com/");
    const ul = document.querySelector("ul");
    sock.on("chatmsg", function (msg) {
      const li = document.createElement("li");
      li.innerText = msg;
      ul.appendChild(li);
      if (ul.childElementCount > 10) {
        ul.removeChild(ul.firstChild);
      }
    });
    const msgInput = document.querySelector("input#msg");
    document.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      sock.send(msgInput.value);
      msgInput.value = "";
    });
  </script>
</span>
