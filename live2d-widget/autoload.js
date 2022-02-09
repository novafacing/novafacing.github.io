// 注意：live2d_path 参数应使用绝对路径
const live2d_path = "/live2d-widget/";
//const live2d_path = "/live2d-widget/";

// 封装异步加载资源的方法
function loadExternalResource(url, type) {
	return new Promise((resolve, reject) => {
		let tag;

		if (type === "css") {
			tag = document.createElement("link");
			tag.rel = "stylesheet";
			tag.href = url;
		}
		else if (type === "js") {
			tag = document.createElement("script");
			tag.src = url;
		}
		if (tag) {
			tag.onload = () => resolve(url);
			tag.onerror = () => reject(url);
			document.head.appendChild(tag);
		}
	});
}

// 加载 waifu.css live2d.min.js waifu-tips.js
if (screen.width >= 768) {
	Promise.all([
		// loadExternalResource(live2d_path + "waifu.css", "css"),
		loadExternalResource(live2d_path + "live2d.min.js", "js"),
		// loadExternalResource(live2d_path + "waifu-tips.js", "js")
	]).then(() => {
    Live2D.init({
      "pluginRootPath": "live2d-widget/",
      "pluginJsPath": "/",
      "pluginModelPath": "assets/",
      "tagMode": false,
      "debug": true,
      "tagMode":false,
      "debug":false,
      "model": {
        "scale":1,
        "hHeadPos":0.5,
        "vHeadPos":0.618,
        "jsonPath":"/live2d-widget/assets/tororo/tororo.model3.json"
      },
      "display": {
        "superSample":2,
        "position":"left",
        "width":150,
        "height":300,
        "hOffset":20,
        "vOffset":-90
      },
      "mobile": {
        "show":true,
        "scale":1
      },
      "react": {
        "opacityDefault":0.3,
        "opacityOnHover":0.3,
        "opacity":0.95},
      "log":false
    });
  });
}
// initWidget 第一个参数为 waifu-tips.json 的路径，第二个参数为 API 地址
// API 后端可自行搭建，参考 https://github.com/fghrsh/live2d_api
// 初始化看板娘会自动加载指定目录下的 waifu-tips.json

console.log(`
  く__,.ヘヽ.        /  ,ー､ 〉
           ＼ ', !-─‐-i  /  /´
           ／｀ｰ'       L/／｀ヽ､
         /   ／,   /|   ,   ,       ',
       ｲ   / /-‐/  ｉ  L_ ﾊ ヽ!   i
        ﾚ ﾍ 7ｲ｀ﾄ   ﾚ'ｧ-ﾄ､!ハ|   |
          !,/7 '0'     ´0iソ|    |
          |.从"    _     ,,,, / |./    |
          ﾚ'| i＞.､,,__  _,.イ /   .i   |
            ﾚ'| | / k_７_/ﾚ'ヽ,  ﾊ.  |
              | |/i 〈|/   i  ,.ﾍ |  i  |
             .|/ /  ｉ：    ﾍ!    ＼  |
              kヽ>､ﾊ    _,.ﾍ､    /､!
              !'〈//｀Ｔ´', ＼ ｀'7'ｰr'
              ﾚ'ヽL__|___i,___,ンﾚ|ノ
                  ﾄ-,/  |___./
                  'ｰ'    !_,.:
`);
