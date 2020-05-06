module.exports = (grunt) ->
    grunt.initConfig
        pkg: grunt.file.readJSON 'package.json'
        coffee:
            default:
                options:
                    bare: true
                    sourceMap: true
                expand: true
                flatten: false
                src: ["src/**/*.coffee","streamer.coffee","runner.coffee","util.coffee","util/*.coffee"]
                dest: 'js/'
                ext: ".js"
            'no-sourcemaps':
                options:
                    bare: true
                    sourceMap: false
                expand: true
                flatten: false
                src: ["src/**/*.coffee","streamer.coffee","runner.coffee","util.coffee","util/*.coffee"]
                dest: 'js/'
                ext: ".js"

        watch:
            coffee:
                files: ['src/**/*.coffee']
                tasks: ['default']

        copy:
            copy_slave_worker:
                files: 'js/src/streammachine/modes/slave_worker.js': ['src/streammachine/modes/slave_worker_js.js']

    grunt.loadNpmTasks 'grunt-contrib-coffee'
    grunt.loadNpmTasks 'grunt-contrib-copy'
    grunt.loadNpmTasks 'grunt-contrib-watch'

    grunt.registerTask 'default', ['coffee:default','copy']
    grunt.registerTask 'build:no-sourcemaps', ['coffee:no-sourcemaps','copy']
    grunt.registerTask 'build:watch', ['watch']
