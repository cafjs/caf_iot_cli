require "luarocks.loader" 
local iot = require("iot")
local json = require("dkjson")


local counter = 9000;

local function readSensors(mapOut) 
   mapOut.temp = counter
   counter = counter + 1
end

local function executeCommand(command, mapIn, mapOut)
   print("Executing command " .. command)
end

local function mainHook(mapIn, mapOut)
   print("Main hook called")
   print("mapIn: " .. json.encode(mapIn))
   print("mapOut: " .. json.encode(mapOut))
end

local spec = { 
   config = {
      url = "http://localhost:3000/iot/x1"      
   },
   interval = 1,
   readSensorsHook = readSensors,
   executeCommandHook = executeCommand,
   mainHook = mainHook
}
   

local main = iot.newMainLoop(spec)
main.start()
