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

local function isEmptyView(view) 
   return (view.toCloud.version == 0) and (view.fromCloud.version == 0)
end

local function gcResponses(maps)
   local toCloud = maps.deviceView.toCloud
   local commands = toCloud and toCloud.values and toCloud.values.commands
   local lastModifVersion = commands and commands.lastModified
   local lastSeenVersion = maps.caView and maps.caView.toCloud and 
      maps.caView.toCloud.version
   if (lastSeenVersion ~= nil) and (lastModifVersion ~= nil) and
      (lastSeenVersion >= lastModifVersion) and commands.values then
      local firstIndex = commands.firstIndex or 0
      commands.firstIndex = firstIndex + #commands.values
      commands.lastModified = nil
      commands.values = {}
      return true
   end
   return false

end

local function slice(array, delta)

end

local function getCommands(maps)
   local fromCloud = maps.caView.fromCloud
   local fromCloudCommands = (fromCloud.values and fromCloud.values.commands) 
      or {}
   local toCloud = maps.deviceView.toCloud
   local toCloudCommands = (toCloud.values and toCloud.values.commands) or {}
   local firstIndex =  toCloudCommands.firstIndex or 0
   firstIndex = firstIndex + ((toCloudCommands.values and
                               #toCloudCommands.values) or 0)
   local firstIndexFromCloud = fromCloudCommands.firstIndex or 0
   local delta
   if firstIndex > firstIndexFromCloud then
      delta = firstIndex - firstIndexFromCloud
   else
      delta = 0
   end
   if fromCloudCommands.values and (#fromCloudCommands.values > delta) then
      return {firstIndex = firstIndexFromCloud + delta, 
              commands = slice(fromCloudCommands.values, delta)}
   else
      return nil
   end
end

local function addResponses(firstIndex, outputs, maps)
   local toCloud = maps.deviceView.toCloud
   toCloud.values = toCloud.values or {}
   toCloud.values.commands = toCloud.values.commands or {}
   toCloud.values.commands.firstIndex = firstIndex
   toCloud.values.commands.lastModified = toCloud.version + 1
   toCloud.values.commands.values = outputs
end

local function updateMaps(maps)
   local toCloud = maps.deviceView.toCloud;
   local fromCloud = maps.deviceView.fromCloud;
   toCloud.version = toCloud.version + 1;
   fromCloud.version = maps.caView.fromCloud.version;
end

local function syncMaps(context, spec, maps)


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
              --- 1 write local data in outMap
              err = readSensorsHook(outMap)
              if err then
                 return err
              end
              --- 2 garbage collect old responses
              gcResponses(maps)
              --- 3 execute commands from request
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
              --- 4 always call the main function  
              err = mainHook(inMap, outMap)
              if err then 
                 return err
              end
              -- 5 update and sync maps with remote target
              if (not isEmptyView(maps.deviceView)) then
                 updateMaps(maps)
              end
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
