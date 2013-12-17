require "luarocks.loader" 
socket = require("socket")
json = require("dkjson")

local exports = {}


local function mapSeries(array, f) 
   local results = {}
   for i, v in ipairs(array) do
      local err
      err, results[i] = f(v)
      if err then
         return err, results
      end
   end
   return nil, results
end

local function emptyView(isDevice)
   return {deviceView =  isDevice, toCloud = {version = 0, values = {}},
           fromCloud =  {version = 0, values = {}}}
end


local function mainConstructor(context, spec, maps) 
   local counter = 0
   local dummyF = function() end

   local readSensorsHook = spec.readSensorsHook or dummyF
   local executeCommandHook = spec.executeCommandHook or dummyF
   local mainHook = spec.mainHook or dummyF

   return (function() 
              local err, data
              maps.caView = maps.caView or emptyView(false)
              maps.deviceView = maps.deviceView or emptyView(true)
              local inMap =  maps.caView.fromCloud.values;
              local outMap = maps.deviceView.toCloud.values;
              --- write local data in outMap
              err = readSensorsHook(outMap)
              if err then
                 return err
              end
              --- garbage collect old responses
              gcResponses(maps)
              --- execute commands from request
              local commandObj = getCommands(maps)
              if commandObj then
                 local commands = commandObj.commands
                 local firstIndex = commandObj.firstIndex
                 err, data = mapSeries(commands, 
                                       function(x)
                                          return executeCommandHook(x, inMap,
                                                                    outMap)
                                       end)
                 if err then 
                    return err
                 end
                 addResponses(firstIndex, data, maps)                 
              end
              --- always call the main function  
              err = mainHook(inMap, outMap)
              if err then 
                 return err
              end
              -- update and sync maps with remote target
              updateMaps(maps)
              return syncMaps(context, spec, maps)              
           end)
end



function exports.newMainLoop(spec)
   local mainLoop = {}
   spec = spec or {}
   local interval = spec.interval or 1
   local context = {}
   local maps = {}
   local iter = mainConstructor(context, spec, maps)
   function mainLoop.start() 
      while true do
         err, data = iter()
         if err then
            return err
         else
            print(data)
            socket.sleep(interval)      
         end
      end
   end

   return mainLoop

end

return exports
