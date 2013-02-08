# CAF (Cloud Assistant Framework)

Co-design permanent, active, stateful, reliable cloud proxies with your web app.

See http://www.cafjs.com 

## CAF Client Lib for IoT devices using node.js

This repository contains a client CAF lib for IoT devices that use node.js to interact with Cloud Assistants.


The client programming model is based on a customizable main loop:

      while(true) {
          readSensorsHook(mapOut, cb);  // (1)
          <garbage_collect_previous_responses();>
          for_each_command_from_CA {
              executeCommandHook(command, mapIn, mapOut, cb); // (2)
          }
          mainHook(mapIn, mapOut, cb); // (3)
          <update_map();>
          <sync_maps_with_CA();>
           <sleep();>
       }

Hooks that can be customized are:

*  **readSensorsHook** Populates a map with readings from external inputs, e.g., GPIO pins.
* **executeCommandHook** Every command sent by the CA is interpreted by this method. The outcome could be a change in mapOut or a value returned in the callback (using node.js conventions) that will be sent back to the CA.
* **mainHook** Gives a chance to this device after reading sensors and executing commands to do some periodic tasks. This hook is always invoked, i.e., even if there were no commands.
    
Internal methods that can only be customized with config properties:

* **GC_responses** Responses that have been ack by the CA do not need to be sent again.
* **Update_map** Increment maps version numbers.
* **Sync_map** Exchange maps with the CA with a single POST
* **Sleep** Wait for `config.interval` miliseconds before retrying.

see `caf_iot/README.md` for details of the wire protocol.


## API

    lib/MainLoop.js
 
## Configuration Example

Config properties passed to constructor `MainLoop`:

     {
        config: configType,
        readSensorsHook: {function(mapOut:Object, caf.cb)},
        executeCommandHook: {function(command:string, mapIn:Object,
                             mapOut:Object, caf.cb)},
        mainHook:{function(mapIn:Object, mapOut:Object, caf.cb)},
        cb: caf.cb // optional callback for error propagation
      }
 
where configType is
 
      {
         url: {string}, // e.g.,'http://helloworld.cafjs.com/iot/2343432423'
         proxy: {string=}, // url with a http proxy (Optional)
         interval:number // sleep timeout in seconds
      }




### framework.json

None


### ca.json

None
        
            
 
