-- require "luarocks.loader" 
local socket = require("socket")
local http = require("socket.http")
local ltnl12 = require("ltn12")
local json = require("dkjson")

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
   local res = {}
   local k = 1 
   for i = delta+1, #array do
      res[k] = array[i]
      k = k + 1
   end
   return res      
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
   local toCloud = maps.deviceView.toCloud
   local fromCloud = maps.deviceView.fromCloud
   toCloud.version = toCloud.version + 1
   fromCloud.version = maps.caView.fromCloud.version
end

local function syncMaps(context, spec, maps)
   context = context or {}
   local config = (spec and spec.config) or {}
   local dummy = context.time and context.time.startRequest()

   local reqJson = json.encode(maps.deviceView or {})
   local respJson = {}
   local result, code, headers, status =  http.request {
      method = "POST",
      url =  config.url,
      proxy = config.proxy,
      source = ltn12.source.string(reqJson),
      headers = {
         ["content-type"] = "application/json",
         ["content-length"] = tostring(#reqJson)
      },
      sink = ltn12.sink.table(respJson) 
   }
   local body, pos, err = json.decode(table.concat(respJson))
   if err then
      return err
   else
      dummy = context.time and context.time.endRequest(headers)
      -- Type of value returned from the cloud:
      --   a) An error message (string)
      --   b) A single object containing the CA view
      --   c) An array with two strings, i.e., JSON serialized device/ca views 
      
      if type(body) == "table" then
         if body[2] ~= nil then -- is an array
            if #body ~= 2 then
               -- error, wrong array size
               return body
            else
               maps.deviceView, pos, err  = json.decode(body[1])
               if err then
                  return err
               end
               if isEmptyView(maps.deviceView) then
                  -- first time initialization
                  maps.deviceView.toCloud.version = 1;
               end
               maps.caView, pos, err = json.decode(body[2])
               if err then
                  return err
               end
               -- c) initialization (first time or out of sync) 
               return nil, maps
            end
         else
            -- b) common case, new view from the cloud
            maps.caView = body
            return nil, body
         end
      else
         -- a) string is an error message
         return body
      end
   end   
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
            print(json.encode(err))
            return err
         else
            print(json.encode(data))
            socket.sleep(interval)      
         end
      end
   end

   return mainLoop

end

return exports
