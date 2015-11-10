'use strict';
var argv = require('yargs').argv;
var gulp = require('gulp');
var del = require('del');
var sourceStream = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var browserify = require('browserify');
var stringify = require('stringify');
var babelify = require('babelify');
var bowerResolve = require('bower-resolve');
var runSequence = require('run-sequence');
var $ = require('gulp-load-plugins')();

var buildPath = './dist';
var uglify = !!argv.uglify;
var webServerStream = null;

// ----------------------------------
// Default Task
// ---------------------------------- 

gulp.task('default', function(cb) {
	runSequence(
		'build',
		'watch',
		'serve',
		cb
	);
});


// ----------------------------------
// Build Tasks
// ---------------------------------- 

gulp.task('build', function(cb) {
	runSequence(
		'clean',
		['build-lib', 'build-api', 'build-app', 'compile-styles', 'copy'],
		cb
	);
});

gulp.task('clean', function(cb) {
	del([buildPath]).then(function() {
		cb();
	});

});

gulp.task('build-lib', function() {
	var b = browserify({ debug: true, noParse: true });
	
	getBowerDependencies().forEach(function(lib) {
		var resolvedPath = bowerResolve.fastReadSync(lib);
		b.require(resolvedPath, { expose: lib })
	});

	return b.bundle()
		.on('error', errorHandler)
		.pipe(sourceStream('lib.js'))
		.pipe(buffer())
		.pipe($.sourcemaps.init({ loadMaps: true }))
			.pipe($.if(uglify, $.uglify()))
		.pipe($.sourcemaps.write('./'))
		.pipe(gulp.dest(buildPath));
});

gulp.task('build-api', function() {
	var b = browserify({ debug: true });
	
	b.require('../src/api/index.js', { expose: 'nb-api' });

	return b.bundle()
		.on('error', errorHandler)
		.pipe(sourceStream('api.js'))
		.pipe(buffer())
		.pipe($.sourcemaps.init({ loadMaps: true }))
			.pipe($.if(uglify, $.uglify()))
		.pipe($.sourcemaps.write('./'))
		.pipe(gulp.dest(buildPath));
});

gulp.task('build-app', function() {
	var b = browserify({ debug: true, paths: ['./src/app'] })
		.transform(babelify, { optional: ['runtime', 'es7.decorators'] })
		.transform(stringify({ minify: uglify }))
		.add('src/app/main');

	getBowerDependencies().forEach(function(lib) {
		b.external(lib);
	});
	b.external('nb-api');

	return b.bundle()
		.on('error', errorHandler)
		.pipe(sourceStream('app.js'))
		.pipe(buffer())
		.pipe($.sourcemaps.init({ loadMaps: true }))
			.pipe($.if(uglify, $.uglify()))
		.pipe($.sourcemaps.write('./'))
		.pipe(gulp.dest(buildPath));
});

gulp.task('compile-styles', function() {
	return gulp.src(['src/app/**/*.less'], { base: '.' })
		.pipe($.lessImport('styles.less'))
		.pipe($.sourcemaps.init())
			.pipe($.less())			
			.on('error', errorHandler)
			.pipe($.if(uglify, $.minifyCss()))
		.pipe($.sourcemaps.write('./'))
		.pipe(gulp.dest(buildPath));
});

gulp.task('copy', function() {
	return gulp.src(['src/index.html', 'src/assets/**/*'], { base: 'src' })
		.pipe(gulp.dest(buildPath));
});

// ----------------------------------
// Watch Tasks
// ---------------------------------- 

gulp.task('watch', [ 'watch-lib', 'watch-app', 'watch-styles', 'watch-assets' ]);

gulp.task('watch-lib', function() {
	$.watch('bower.json', function() {
		// Invalidate the cached bower.json.
		delete require.cache[require.resolve('bower.json')];
		runSequence('build-lib');
	});	
});

gulp.task('watch-app', function() {
	// Watch speperated because of gulp-watch bug.

	$.watch('src/app/**/*.js', function() {
		runSequence('build-app');
	});	

	$.watch('src/app/**/*.html', function() {
		runSequence('build-app');
	});		
});

gulp.task('watch-styles', function() {
	$.watch(['src/app/**/*.less'], function() {
		runSequence('compile-styles')
	});
});

gulp.task('watch-assets', function() {
	$.watch(['src/index.html', 'src/assets/*'], function(vinyl) {
		// Copy the file that changed.
		gulp.src(vinyl.path, { base: 'src' })
			.pipe(gulp.dest(buildPath));
	});	
})

// ----------------------------------
// Web Server Tasks
// ----------------------------------
var wsStream;
gulp.task('serve', function() {
	wsStream && esStream.emit('kill');

	wsStream = gulp.src(buildPath)
		.pipe($.webserver({
			fallback: '/index.html',
			open: true
		}));

	return wsStream;
})

// ----------------------------------
// Helper functions
// ---------------------------------- 

function getBowerDependencies() {
	var dependencies = {};
	try {
		dependencies = require('./bower.json').dependencies;
	} catch (e) {
	}

	return Object.keys(dependencies);
}

function errorHandler(err) {
	console.log(err.toString(), '\u0007');
	this.emit('end');	
}
