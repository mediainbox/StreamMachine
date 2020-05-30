LISTEN
======

"datetime": "2020-05-25T23:59:59.952Z",
"stream": "cadena3.mp3",
"session_id": "25197410-d1ef-4562-949d-61d29a5cabb3",
"kbytes": 233, // listen kbytes
"duration": 59.977142857142766, // listen duration
"session_start": "2020-05-25T23:59:59.952Z",
"session_duration": 1020, // accumulated
"session_kbytes": 1020, // accumulated
"output": "raw",
"unique_listener_id": "",
"client": {
  "ip": "181.14.224.163",
  "path": "/cadena3.mp3",
  "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.61 Safari/537.36"
},
"geo": {
  "continent": "",
  "country": "",
  "city": ""
}


SESSION
=======

"datetime": "2020-05-25T23:59:59.952Z",
"stream": "cadena3.mp3",
"session_id": "25197410-d1ef-4562-949d-61d29a5cabb3",
"session_last": "2020-05-25T23:59:59.952Z",
"session_duration": 1020,
"session_kbytes": 1020,
"output": "raw",
"unique_listener_id": "",
"client": {
  "ip": "181.14.224.163",
  "path": "/cadena3.mp3",
  "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.61 Safari/537.36"
},
"geo": {
  "continent": "",
  "country": "",
  "city": ""
}


Metricas
========
Inicios de sesión (SS): sessions > COUNT * WHERE datetime BETWEEN 1 min interval AND duration >= 60

Sesiones activas (AS): sessions > COUNT * WHERE datetime > start AND endTs < end AND duration >= 60

Total de horas de escucha (TLH): listens > SUM duration WHERE datetime IN range

Total de horas de escucha (AAS): ???

Audiencia por cuarto de hora (AQH): sessions > COUNT * WHERE datetime > start AND endTs < end AND duration >= 300

