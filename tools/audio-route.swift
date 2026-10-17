#!/usr/bin/env swift
// Create a persistent Multi-Output Device through CoreAudio, preserving a restore point.
import Foundation
import CoreAudio

let system = AudioObjectID(kAudioObjectSystemObject)
let routeUID = "org.phosphor-loop.multi-output"
let stateURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent(".capture-state/audio-route.json")
func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func check(_ status: OSStatus, _ action: String) throws {
    if status != noErr { throw NSError(domain: "CoreAudio", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "\(action): CoreAudio error \(status)"]) }
}
func string(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) throws -> String {
    var a = address(selector), value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    try check(AudioObjectGetPropertyData(id, &a, 0, nil, &size, &value), "Read device name/UID")
    return value as String
}
func defaultDevice(_ selector: AudioObjectPropertySelector) throws -> AudioObjectID {
    var a = address(selector), value = AudioObjectID(0), size = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(AudioObjectGetPropertyData(system, &a, 0, nil, &size, &value), "Read default output")
    return value
}
func setDefault(_ selector: AudioObjectPropertySelector, _ id: AudioObjectID) throws {
    var a = address(selector), value = id
    try check(AudioObjectSetPropertyData(system, &a, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &value), "Set default output")
}
func devices() throws -> [AudioObjectID] {
    var a = address(kAudioHardwarePropertyDevices), size: UInt32 = 0
    try check(AudioObjectGetPropertyDataSize(system, &a, 0, nil, &size), "List devices")
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    try check(AudioObjectGetPropertyData(system, &a, 0, nil, &size, &ids), "List devices")
    return ids
}
func hasStreams(_ id: AudioObjectID, _ scope: AudioObjectPropertyScope) -> Bool {
    var a = address(kAudioDevicePropertyStreams, scope), size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(id, &a, 0, nil, &size) == noErr && size > 0
}
func fail(_ text: String) -> NSError { NSError(domain: "Phosphor", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
func restore() throws {
    let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as! [String: String]
    let all = try devices()
    for (key, selector) in [("output", kAudioHardwarePropertyDefaultOutputDevice), ("system", kAudioHardwarePropertyDefaultSystemOutputDevice)] {
        guard let id = try all.first(where: { try string($0, kAudioDevicePropertyDeviceUID) == saved[key] }) else {
            throw fail("The previous \(key) device is unavailable. Reconnect it or choose an output in Sound settings.")
        }
        try setDefault(selector, id)
    }
    // Keep the saved route and restore point; repeated restore/setup commands remain safe.
    print("Restored the previous speaker/headphone outputs. BlackHole remains installed.")
}
do {
    let command = CommandLine.arguments.dropFirst().first ?? "list"
    let all = try devices()
    if command == "list" {
        let current = try defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
        for id in all {
            let input = hasStreams(id, kAudioDevicePropertyScopeInput) ? "input" : ""
            let output = hasStreams(id, kAudioDevicePropertyScopeOutput) ? "output" : ""
            print("\(id == current ? "*" : " ") \(try string(id, kAudioObjectPropertyName)) [\(input) \(output)]")
        }
    } else if command == "restore" {
        try restore()
    } else if command == "setup" {
        guard let blackhole = try all.first(where: { try string($0, kAudioObjectPropertyName) == "BlackHole 2ch" }) else {
            throw fail("BlackHole 2ch is not available. Install with brew install --cask blackhole-2ch, then restart if needed.")
        }
        let current = try defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
        let currentUID = try string(current, kAudioDevicePropertyDeviceUID)
        if currentUID == routeUID { print("Phosphor Loop + Speakers is already the default output."); exit(0) }
        if current == blackhole { throw fail("Choose your speakers/headphones as the output first, then run setup again.") }
        let oldSystem = try defaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice)
        let saved = ["output": currentUID, "system": try string(oldSystem, kAudioDevicePropertyDeviceUID)]
        try FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: saved, options: [.prettyPrinted]).write(to: stateURL, options: [.atomic])
        if let oldRoute = try all.first(where: { try string($0, kAudioDevicePropertyDeviceUID) == routeUID }) {
            try check(AudioHardwareDestroyAggregateDevice(oldRoute), "Replace Phosphor multi-output route")
        }
        let description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Phosphor Loop + Speakers",
            kAudioAggregateDeviceUIDKey: routeUID,
            kAudioAggregateDeviceMainSubDeviceKey: currentUID,
            kAudioAggregateDeviceIsPrivateKey: 0,
            kAudioAggregateDeviceIsStackedKey: 0, // Feed the same stereo channels to both outputs.
            kAudioAggregateDeviceSubDeviceListKey: [
                [kAudioSubDeviceUIDKey: currentUID],
                [kAudioSubDeviceUIDKey: try string(blackhole, kAudioDevicePropertyDeviceUID), kAudioSubDeviceDriftCompensationKey: 1]
            ]
        ]
        var route = AudioObjectID(0)
        try check(AudioHardwareCreateAggregateDevice(description as CFDictionary, &route), "Create multi-output route")
        do {
            try setDefault(kAudioHardwarePropertyDefaultOutputDevice, route)
            try setDefault(kAudioHardwarePropertyDefaultSystemOutputDevice, route)
        } catch {
            try? restore()
            throw error
        }
        print("System audio now goes to \(try string(current, kAudioObjectPropertyName)) AND BlackHole 2ch.")
        print("Restore with: npm run audio:restore")
    } else { throw fail("Use list, setup, or restore.") }
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
}
