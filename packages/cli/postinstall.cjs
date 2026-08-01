#!/usr/bin/env node
var fs = require('fs');
var path = require('path');

var packages = [
    'core', 'llm', 'agent-config', 'agent-management', 'analytics',
    'client-sdk', 'registry', 'server', 'storage', 'tui',
    'image-local', 'image-logger-agent', 'orchestration',
    'tools-builtins', 'tools-filesystem', 'tools-git',
    'tools-lifecycle', 'tools-plan', 'tools-process',
    'tools-scheduler', 'tools-todo'
];

function createSymlinksInDir(nfDir) {
    if (!fs.existsSync(nfDir)) return;
    try {
        var afDir = path.join(nfDir, '@fius');
        fs.mkdirSync(afDir, { recursive: true });
        for (var i = 0; i < packages.length; i++) {
            var pkg = packages[i];
            var target = path.join(nfDir, '@fiusdev', pkg);
            var link = path.join(afDir, pkg);
            try {
                if (fs.existsSync(link) && !fs.lstatSync(link).isSymbolicLink()) {
                    fs.rmSync(link, { recursive: true, force: true });
                }
                if (!fs.existsSync(link) && fs.existsSync(target)) {
                    fs.symlinkSync(target, link, 'junction');
                }
            } catch(e) {}
        }
    } catch(e) {}
}

function walkAndFix(dir) {
    createSymlinksInDir(dir);
    var nm = path.join(dir, 'node_modules');
    if (!fs.existsSync(nm)) return;
    try {
        var entries = fs.readdirSync(nm);
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            if (entry === '.') continue;
            if (entry === '@types') continue;
            if (entry === '@fiusdev') {
                var scopeDir = path.join(nm, entry);
                var pkgs = fs.readdirSync(scopeDir);
                for (var j = 0; j < pkgs.length; j++) {
                    walkAndFix(path.join(scopeDir, pkgs[j]));
                }
            } else if (!entry.startsWith('.')) {
                walkAndFix(path.join(nm, entry));
            }
        }
    } catch(e) {}
}

try {
    walkAndFix(path.join(__dirname));
} catch(e) {}
