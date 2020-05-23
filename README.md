- /listeners no responde
- analytics cpu
- +5k listeners

# StreamMachine

StreamMachine is an open-source streaming audio server aimed at pushing
innovation for radio stations that have spent too many years running old
technology like Shoutcast and Icecast.

The project has two goals: emulating the traditional streaming experience and
building support for new features that push the radio listening experience
forward. Currently StreamMachine supports traditional Shoutcast-style streaming and HTTP Live Streaming.

StreamMachine is being developed by [Eric Richardson](http://ewr.is) (e@ewr.is)
and [Southern California Public Radio](http://scpr.org). SCPR has run
StreamMachine in production since 2012.

[![Build Status](https://travis-ci.org/StreamMachine/StreamMachine.svg)](https://travis-ci.org/StreamMachine/StreamMachine)

## The Rewind Buffer

StreamMachine's big idea is keeping a big buffer of audio data in memory,
allowing clients to connect to "nearly-live" radio. Because audio data is
relatively small, a station can easily keep hours of audio in memory.  For
instance, a 64k MP3 stream will store 8 hours of audio data in just a little
over 200MB of memory.

Using the Rewind Buffer, players can add support for concepts like "Play
the current program from its start", or "Play the 9am broadcast." Unlike
podcasts, these functions are available immediately and keep the user connected
to the station's live stream.

You can read more about the implementation of the
[RewindBuffer in the wiki](https://github.com/StreamMachine/StreamMachine/wiki/RewindBuffer).

## Analytics

StreamMachine includes support for writing analytics into Elasticsearch. Output
includes listening events&mdash;chunks of listening that reflect a segment of
duration delivered&mdash;and rolled-up sessions.

Unlike traditional streaming log outputs, StreamMachine's listening events
allow deep realtime analysis of user beahvior, including playhead position and
in-flight session durations.

## Source Transcoding

With the new Source Mounts support in 0.7, StreamMachine now supports taking
one input source and transcoding it into the variety of output formats you
may want to offer your listeners.

## Architecture

StreamMachine is a [Node.js](http://nodejs.org) application.  It can run on
one server, or in a master-slave configuration for load-balancing.
StreamMachine is designed for Node 0.10 and higher.

#### Configuration

Static configuration can be done via a JSON configuration file.  Configuration
changes will not be written back to the file.

For a dynamic configuration, StreamMachine can store its stream information on
a [Redis](http://redis.io) server.

#### Incoming Audio

Two modes are supported for incoming audio:

* __Icecast Source:__ The `SourceIn` module emulates the Icecast server's
	source handling, allowing source clients to connect to a mount point and
	provide a source password.

* __Proxy:__ The `ProxyRoom` module can connect to an existing Icecast server
	and proxy its stream through the StreamMachine infrastructure.

#### Supported Formats

Currently, MP3 and AAC streams are supported.

#### Operation Modes

StreamMachine can operate as a single process or in a master-slave configuration.

* __Standalone:__ One process manages both incoming and outgoing audio. For
    development and small installations.

* __Master:__ Master handles source connections and configuration. Provides the
    admin UI and centralizes logging from slave processes. Handles no client traffic.

* __Slave:__ Slave handles all client requests. Stream audio is proxied from the
    master over a single socket connection.

For more, see the
[Mode documentation in the wiki](https://github.com/StreamMachine/StreamMachine/wiki/Modes).

## Outputs

* __Raw Audio:__ Realtime audio stream output appropriate for HTML5 audio tags
    and other web players

* __Shoutcast:__ Realtime audio stream that injects Shoutcast-style metadata
    at intervals

* __HTTP Live Streaming:__ Apple's HTTP Live Streaming protocol uses playlists
    and audio segments to replace long-lived connections. StreamMachine supports
    segment chunking and can produce HLS playlists for individual streams and
    adaptive stream groups.

* __Pumper:__ Allows chunks of audio to be downloaded as quickly as possible

## Alerts

Alerts are intended to provide a heads-up when something's going wrong in
the streaming process. A similar alert will fire when the condition is ended.
Where logging is intended to signal an event, alerts are about signalling
that a condition exists.

Alerts can be sent via email or [Pagerduty](http://pagerduty.com).

## Configuration

StreamMachine uses [nconf](https://github.com/flatiron/nconf) to load
configuration settings from a JSON file, from environment variables and from
the command line.

For more, see the
[full documentation of configuration options](https://github.com/StreamMachine/StreamMachine/wiki/Configuration-settings).

## Handoff Restarts

Traditional streaming is done using long-lived connections that can make life
painful when you need to deploy a new code release. StreamMachine is able to
accomplish live restarts by doing a "handoff" where the old process passes all
clients to the new process before shutting down.

To manage this process, StreamMachine ships with the "streammachine-runner"
command. The runner is a lightweight process that will manage the StreamMachine
process, initiating a handoff based on either a `SIGHUP` or a change to a
watched trigger file.

## Getting Started

StreamMachine isn't the most user-friendly piece of software to install at the
moment, but there are two options for quickly getting something running that
you can play with:

#### Running Locally (Repo)

To run StreamMachine locally with no service dependencies, try the included `config/standalone.json`. To do so:

* Install Node.js
* Download the StreamMachine repository
* Run `npm install` to install the Node modules that we depend on
* Run `./streammachine-cmd --config ./config/standalone.json` to start the
  StreamMachine service

The included configuration has an MP3 stream configured at /test, with the
source password "testing".  The source input listener is on port 8002, and
that is where the broadcast should be pointed. To connect using an included
source utility, run:

    ./streammachine-util-cmd source --port 8002 --stream test \
    --password testing ./test/files/mp3/mp3-44100-128-s.mp3

To listen, point an audio player to `http://127.0.0.1:8001/test`.

The admin API is available at `http://127.0.0.1:8001/api`.

#### Vagrant

You can also [use the Vagrantfile included in streammachine-cookbook](https://github.com/StreamMachine/streammachine-cookbook)
to install a standalone configuration in a virtual machine.
