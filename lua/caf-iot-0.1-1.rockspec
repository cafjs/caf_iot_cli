package = "caf-iot"
version = "0.1-1"
source = {
  url = "https://github.com/cafjs/caf_iot_cli/blob/master/lua/iot.lua"
}
description = {
  summary = "CAF client library for IoT devices",
  detailed = [[
This library is a clone of the node.js package caf_iot_cli. 

It targets devices that do not have enough memory to run node.js.

]],
  homepage = "http://www.cafjs.com",
  license = "Apache 2.0"
}
dependencies = {
  "lua >= 5.1, < 5.3",
  "dkjson >= 2.4",
  "LuaSocket >= 2.0"
}
build = {
  type = "builtin",
  modules = {
    iot = "iot.lua"
  }
}
