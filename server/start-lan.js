#!/usr/bin/env node
/** 监听所有网卡，供手机/模拟器通过局域网访问 */
process.env.HOST = process.env.HOST || '0.0.0.0'
require('./app.js')