module.exports = (grunt) ->
    grunt.initConfig
        pkg: grunt.file.readJSON 'package.json'
        coffee:
            default:
                options:
                    bare: true
                    sourceMap: false
                expand: true
                flatten: false
                src: ["coffee/**/*.coffee"]
                dest: 'coffee/js'
                ext: ".js"

    grunt.loadNpmTasks 'grunt-contrib-coffee'

    grunt.registerTask 'default', ['coffee:default']
