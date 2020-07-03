# martango.github.io

I'll put something here soon.

<ul>
</ul>

<span>
  <script src="//cdnjs.cloudflare.com/ajax/libs/socket.io/2.2.0/socket.io.js"></script>
  <script type="text/javascript">
    const sock = io("https://marchat.herokuapp.com/");
    const ul = document.querySelector("ul");
    sock.on("chatmsg", function (msg) {
      const li = document.createElement("li");
      li.innerText = msg;
      ul.appendChild(li);
    });
    setInterval(function () {
      sock.send("Ping!")
    }, 1000);
  </script>
</span>
