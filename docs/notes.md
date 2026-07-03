Windows PowerShell
Copyright (C) Microsoft Corporation. All rights reserved.

Install the latest PowerShell for new features and improvements! https://aka.ms/PSWindows

Loading personal and system profiles took 1209ms.
(base) PS C:\Users\Jim> # Make a simple request to load the model
(base) PS C:\Users\Jim> Invoke-WebRequest -Uri http://127.0.0.1:8080/v1/models

Security Warning: Script Execution Risk
Invoke-WebRequest parses the content of the web page. Script code in the web page might be run when the page is
parsed.
      RECOMMENDED ACTION:
      Use the -UseBasicParsing switch to avoid script code execution.

      Do you want to continue?

[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "N"): y


StatusCode        : 200
StatusDescription : OK
Content           : {"object":"list","data":[{"id":"pocket-tts","object":"model","owned_by":"engine","family":"pocket_t
                    ts","task":"tts","mode":"offline"}]}
RawContent        : HTTP/1.1 200 OK
                    Connection: close
                    Content-Length: 135
                    Content-Type: application/json

                    {"object":"list","data":[{"id":"pocket-tts","object":"model","owned_by":"engine","family":"pocket_t
                    ts","task"...
Forms             : {}
Headers           : {[Connection, close], [Content-Length, 135], [Content-Type, application/json]}
Images            : {}
InputFields       : {}
Links             : {}
ParsedHtml        : System.__ComObject
RawContentLength  : 135



(base) PS C:\Users\Jim> # Test TTS via HTTP API
(base) PS C:\Users\Jim> $body = @{
>>     model = "pocket-tts"
>>     input = "Hello, this is a test of the Pocket TTS engine. It sounds really good!"
>>     voice = "alba"
>>     response_format = "wav"
>> } | ConvertTo-Json
(base) PS C:\Users\Jim>
(base) PS C:\Users\Jim> Invoke-RestMethod -Uri "http://127.0.0.1:8080/v1/audio/speech" `
>>     -Method POST `
>>     -Body $body `
>>     -ContentType "application/json" `
>>     -OutFile "test_pocket_tts.wav"
(base) PS C:\Users\Jim> start test_pocket_tts.wav
(base) PS C:\Users\Jim>