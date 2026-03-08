//
//  ContentView.swift
//  Paketnummer
//
//  Created by TJM on 22.02.26.
//

import SwiftUI
import UIKit
import Vision
import SQLite3
import Network
import Combine
import CoreBluetooth
// NOTE: Add your logo PNG to Assets.xcassets as an Image Set named "BrandLogo". Set AppIcon in Assets to use your logo for the app icon.

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")
        }
        .padding()
    }
}

#Preview {
    ContentView()
}

#if canImport(SQLite3)
// Provide SQLITE_TRANSIENT for sqlite3_bind_text if not available from the module
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
#endif

// MARK: - App

@main
struct PaketLagerApp: App {
    @State private var showSplash = true

    var body: some Scene {
        WindowGroup {
            Group {
                if showSplash {
                    SplashView()
                } else {
                    RootView()
                }
            }
            .task {
                // Show splash for ~1.5 seconds
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                withAnimation(.easeInOut) { showSplash = false }
            }
        }
    }
}
// MARK: - Root Tabs

struct RootView: View {
    @StateObject private var store = PackageStore()

    var body: some View {
        TabView {
            ReceiveView()
                .tabItem { Label("Annahme", systemImage: "camera") }

            SearchView()
                .tabItem { Label("Suche", systemImage: "magnifyingglass") }

            SettingsView()
                .tabItem { Label("Einstellungen", systemImage: "gearshape") }
        }
        .environmentObject(store)
        .task {
            do { try store.bootstrap() }
            catch { print("DB bootstrap error:", error) }
        }
    }
}

// MARK: - Models

struct PackageRecord: Identifiable, Equatable {
    let id: String
    var slot: Int
    var firstName: String
    var lastName: String
    var street: String
    var houseNo: String
    var postalCode: String
    var city: String
    var arrivalAt: Date

    var fullName: String {
        "\(firstName) \(lastName)".trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var addressLine: String {
        let s = street.trimmingCharacters(in: .whitespacesAndNewlines)
        let h = houseNo.trimmingCharacters(in: .whitespacesAndNewlines)
        return ([s, h].filter { !$0.isEmpty }).joined(separator: " ")
    }

    var slot3: String { String(format: "%03d", slot) }

    var formattedDateDE: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "dd.MM.yyyy"
        return f.string(from: arrivalAt)
    }
    
    var formattedDateTimeDE: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "dd.MM.yyyy HH:mm"
        return f.string(from: arrivalAt)
    }
}

struct ExtractedFields: Equatable {
    var firstName: String = ""
    var lastName: String = ""
    var street: String = ""
    var houseNo: String = ""
    var postalCode: String = ""
    var city: String = ""
}

// MARK: - SQLite Wrapper

final class SQLiteDB {
    private var db: OpaquePointer?

    deinit { close() }

    func open(path: String) throws {
        if sqlite3_open(path, &db) != SQLITE_OK {
            throw DBError.openFailed(lastError())
        }
        try exec("PRAGMA journal_mode=WAL;")
        try exec("PRAGMA foreign_keys=ON;")
    }

    func close() {
        if db != nil {
            sqlite3_close(db)
            db = nil
        }
    }

    func exec(_ sql: String) throws {
        var errMsg: UnsafeMutablePointer<Int8>?
        if sqlite3_exec(db, sql, nil, nil, &errMsg) != SQLITE_OK {
            let msg = errMsg.map { String(cString: $0) } ?? "Unknown"
            sqlite3_free(errMsg)
            throw DBError.execFailed(msg)
        }
    }

    func prepare(_ sql: String) throws -> OpaquePointer? {
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) != SQLITE_OK {
            throw DBError.prepareFailed(lastError())
        }
        return stmt
    }

    func lastError() -> String {
        guard let dbp = db else { return "SQLite DB is nil" }
        return String(cString: sqlite3_errmsg(dbp))
    }

    enum DBError: Error, LocalizedError {
        case openFailed(String)
        case execFailed(String)
        case prepareFailed(String)
        case bindFailed(String)
        case stepFailed(String)

        var errorDescription: String? {
            switch self {
            case .openFailed(let s): return "DB open failed: \(s)"
            case .execFailed(let s): return "DB exec failed: \(s)"
            case .prepareFailed(let s): return "DB prepare failed: \(s)"
            case .bindFailed(let s): return "DB bind failed: \(s)"
            case .stepFailed(let s): return "DB step failed: \(s)"
            }
        }
    }
}

// MARK: - Store

@MainActor
final class PackageStore: ObservableObject {
    @Published var printerIP: String = UserDefaults.standard.string(forKey: "printer_ip") ?? ""
    @Published var printerPort: Int = {
        let p = UserDefaults.standard.integer(forKey: "printer_port")
        return p == 0 ? 9100 : p
    }()
    
    enum PrinterMode: String, CaseIterable, Identifiable { case label, airPrint, bluetooth; var id: String { rawValue } }
    enum LabelSize: String, CaseIterable, Identifiable {
        case mm100x100 = "100×100 mm"
        case mm100x50  = "100×50 mm"
        case mm58x40   = "58×40 mm"
        case mm62x29   = "62×29 mm"
        case mm50x30   = "50×30 mm"
        case mm40x20   = "40×20 mm"
        var id: String { rawValue }
    }
    enum PaperSize: String, CaseIterable, Identifiable { case a4 = "A4", a5 = "A5", a6 = "A6", letter = "US Letter", legal = "US Legal"; var id: String { rawValue } }
    enum Orientation: String, CaseIterable, Identifiable { case portrait = "Hochformat", landscape = "Querformat"; var id: String { rawValue } }
    enum ScaleMode: String, CaseIterable, Identifiable { case center = "Zentriert", fitWidth = "Auf Breite", fitHeight = "Auf Höhe"; var id: String { rawValue } }

    @Published var printerMode: PrinterMode = PrinterMode(rawValue: UserDefaults.standard.string(forKey: "printer_mode") ?? "label") ?? .label
    @Published var labelSize: LabelSize = LabelSize(rawValue: UserDefaults.standard.string(forKey: "label_size") ?? LabelSize.mm100x100.rawValue) ?? .mm100x100
    @Published var paperSize: PaperSize = PaperSize(rawValue: UserDefaults.standard.string(forKey: "paper_size") ?? PaperSize.a4.rawValue) ?? .a4
    @Published var orientation: Orientation = Orientation(rawValue: UserDefaults.standard.string(forKey: "orientation") ?? Orientation.portrait.rawValue) ?? .portrait
    @Published var scaleMode: ScaleMode = ScaleMode(rawValue: UserDefaults.standard.string(forKey: "scale_mode") ?? ScaleMode.center.rawValue) ?? .center
    @Published var fontScale: Double = {
        let v = UserDefaults.standard.double(forKey: "font_scale")
        return v == 0 ? 1.0 : v
    }()
    @Published var bluetoothDeviceName: String = UserDefaults.standard.string(forKey: "bt_device_name") ?? ""
    @Published var bluetoothDeviceIdentifier: String = UserDefaults.standard.string(forKey: "bt_device_identifier") ?? ""

    private let db = SQLiteDB()
    private var dbOpened = false

    private var dbPath: String {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return dir.appendingPathComponent("paketlager.sqlite").path
    }

    func bootstrap() throws {
        guard !dbOpened else { return }
        try db.open(path: dbPath)
        dbOpened = true
        try createSchemaIfNeeded()
    }

    private func createSchemaIfNeeded() throws {
        try db.exec("""
        CREATE TABLE IF NOT EXISTS packages (
          id TEXT PRIMARY KEY NOT NULL,
          slot INTEGER NOT NULL UNIQUE,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          street TEXT NOT NULL,
          house_no TEXT NOT NULL,
          postal_code TEXT NOT NULL,
          city TEXT NOT NULL,
          arrival_at INTEGER NOT NULL
        );
        """)
        try db.exec("CREATE INDEX IF NOT EXISTS idx_name ON packages(last_name, first_name);")
        try db.exec("CREATE INDEX IF NOT EXISTS idx_addr ON packages(street, postal_code, city);")
        try db.exec("""
        CREATE TABLE IF NOT EXISTS pending_prints (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        """)
    }

    func savePrinterSettings(ip: String, port: Int) {
        printerIP = ip.trimmingCharacters(in: .whitespacesAndNewlines)
        printerPort = port
        UserDefaults.standard.set(printerIP, forKey: "printer_ip")
        UserDefaults.standard.set(printerPort, forKey: "printer_port")
        UserDefaults.standard.set(printerMode.rawValue, forKey: "printer_mode")
        UserDefaults.standard.set(labelSize.rawValue, forKey: "label_size")
        UserDefaults.standard.set(paperSize.rawValue, forKey: "paper_size")
        UserDefaults.standard.set(orientation.rawValue, forKey: "orientation")
        UserDefaults.standard.set(scaleMode.rawValue, forKey: "scale_mode")
        UserDefaults.standard.set(fontScale, forKey: "font_scale")
        UserDefaults.standard.set(bluetoothDeviceName, forKey: "bt_device_name")
        UserDefaults.standard.set(bluetoothDeviceIdentifier, forKey: "bt_device_identifier")
    }

    private func allocateSlot() throws -> Int {
        let sql = "SELECT slot FROM packages ORDER BY slot ASC;"
        guard let stmt = try db.prepare(sql) else { throw SQLiteDB.DBError.prepareFailed("nil stmt") }
        defer { sqlite3_finalize(stmt) }

        var used: [Int] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            used.append(Int(sqlite3_column_int(stmt, 0)))
        }

        var candidate = 1
        for s in used {
            if s == candidate { candidate += 1 }
            else if s > candidate { break }
        }
        if candidate > 500 {
            throw NSError(domain: "PaketLager", code: 1, userInfo: [NSLocalizedDescriptionKey: "Lager voll (500/500)."])
        }
        return candidate
    }

    func createPackage(fields: ExtractedFields, arrivalAt: Date) throws -> PackageRecord {
        let slot = try allocateSlot()
        let id = UUID().uuidString
        let arrivalTs = Int64(arrivalAt.timeIntervalSince1970)

        let sql = """
        INSERT INTO packages (id, slot, first_name, last_name, street, house_no, postal_code, city, arrival_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        guard let stmt = try db.prepare(sql) else { throw SQLiteDB.DBError.prepareFailed("nil stmt") }
        defer { sqlite3_finalize(stmt) }

        func bindText(_ idx: Int32, _ value: String) throws {
            if sqlite3_bind_text(stmt, idx, value, -1, SQLITE_TRANSIENT) != SQLITE_OK {
                throw SQLiteDB.DBError.bindFailed(db.lastError())
            }
        }

        if sqlite3_bind_text(stmt, 1, id, -1, SQLITE_TRANSIENT) != SQLITE_OK { throw SQLiteDB.DBError.bindFailed(db.lastError()) }
        if sqlite3_bind_int(stmt, 2, Int32(slot)) != SQLITE_OK { throw SQLiteDB.DBError.bindFailed(db.lastError()) }
        try bindText(3, fields.firstName)
        try bindText(4, fields.lastName)
        try bindText(5, fields.street)
        try bindText(6, fields.houseNo)
        try bindText(7, fields.postalCode)
        try bindText(8, fields.city)
        if sqlite3_bind_int64(stmt, 9, arrivalTs) != SQLITE_OK { throw SQLiteDB.DBError.bindFailed(db.lastError()) }

        if sqlite3_step(stmt) != SQLITE_DONE {
            throw SQLiteDB.DBError.stepFailed(db.lastError())
        }

        return PackageRecord(
            id: id, slot: slot,
            firstName: fields.firstName, lastName: fields.lastName,
            street: fields.street, houseNo: fields.houseNo,
            postalCode: fields.postalCode, city: fields.city,
            arrivalAt: arrivalAt
        )
    }

    func search(q: String) throws -> [PackageRecord] {
        let query = q.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty { return [] }

        let like = "%\(query)%"
        let sql = """
        SELECT id, slot, first_name, last_name, street, house_no, postal_code, city, arrival_at
        FROM packages
        WHERE first_name LIKE ? OR last_name LIKE ? OR street LIKE ? OR house_no LIKE ? OR postal_code LIKE ? OR city LIKE ?
        ORDER BY arrival_at DESC
        LIMIT 50;
        """
        guard let stmt = try db.prepare(sql) else { throw SQLiteDB.DBError.prepareFailed("nil stmt") }
        defer { sqlite3_finalize(stmt) }

        for i in 1...6 {
            if sqlite3_bind_text(stmt, Int32(i), like, -1, SQLITE_TRANSIENT) != SQLITE_OK {
                throw SQLiteDB.DBError.bindFailed(db.lastError())
            }
        }

        var results: [PackageRecord] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            let id = String(cString: sqlite3_column_text(stmt, 0))
            let slot = Int(sqlite3_column_int(stmt, 1))
            let fn = String(cString: sqlite3_column_text(stmt, 2))
            let ln = String(cString: sqlite3_column_text(stmt, 3))
            let street = String(cString: sqlite3_column_text(stmt, 4))
            let houseNo = String(cString: sqlite3_column_text(stmt, 5))
            let pc = String(cString: sqlite3_column_text(stmt, 6))
            let city = String(cString: sqlite3_column_text(stmt, 7))
            let arrivalTs = Int64(sqlite3_column_int64(stmt, 8))

            results.append(PackageRecord(
                id: id, slot: slot,
                firstName: fn, lastName: ln,
                street: street, houseNo: houseNo,
                postalCode: pc, city: city,
                arrivalAt: Date(timeIntervalSince1970: TimeInterval(arrivalTs))
            ))
        }
        return results
    }

    func deletePackage(id: String) throws {
        let sql = "DELETE FROM packages WHERE id = ?;"
        guard let stmt = try db.prepare(sql) else { throw SQLiteDB.DBError.prepareFailed("nil stmt") }
        defer { sqlite3_finalize(stmt) }

        if sqlite3_bind_text(stmt, 1, id, -1, SQLITE_TRANSIENT) != SQLITE_OK {
            throw SQLiteDB.DBError.bindFailed(db.lastError())
        }
        if sqlite3_step(stmt) != SQLITE_DONE {
            throw SQLiteDB.DBError.stepFailed(db.lastError())
        }
    }

    func printLabel(for pkg: PackageRecord) async throws {
        let zpl = ZPLBuilder.label(slot3: pkg.slot3, name: pkg.fullName, date: pkg.formattedDateDE, size: labelSize, orientation: orientation, fontScale: fontScale)
        switch printerMode {
        case .label:
            try await RawTCPPrinter.send(host: printerIP, port: printerPort, payload: zpl)
        case .airPrint:
            // AirPrint is handled by callers via PDF; fallthrough to no-op here
            return
        case .bluetooth:
            try await BluetoothPrinter.send(payload: zpl, deviceIdentifier: bluetoothDeviceIdentifier)
        }
    }
    
    func enqueuePendingPrint(payload: String) throws {
        let sql = "INSERT OR REPLACE INTO pending_prints (id, payload, created_at) VALUES (?, ?, ?);"
        guard let stmt = try db.prepare(sql) else { throw SQLiteDB.DBError.prepareFailed("nil stmt") }
        defer { sqlite3_finalize(stmt) }
        let id = UUID().uuidString
        let ts = Int64(Date().timeIntervalSince1970)
        if sqlite3_bind_text(stmt, 1, id, -1, SQLITE_TRANSIENT) != SQLITE_OK { throw SQLiteDB.DBError.bindFailed(db.lastError()) }
        if sqlite3_bind_text(stmt, 2, payload, -1, SQLITE_TRANSIENT) != SQLITE_OK { throw SQLiteDB.DBError.bindFailed(db.lastError()) }
        if sqlite3_bind_int64(stmt, 3, ts) != SQLITE_OK { throw SQLiteDB.DBError.bindFailed(db.lastError()) }
        if sqlite3_step(stmt) != SQLITE_DONE { throw SQLiteDB.DBError.stepFailed(db.lastError()) }
    }
    
    func pendingPrintCount() throws -> Int {
        let sql = "SELECT COUNT(*) FROM pending_prints;"
        guard let stmt = try db.prepare(sql) else { throw SQLiteDB.DBError.prepareFailed("nil stmt") }
        defer { sqlite3_finalize(stmt) }
        var count = 0
        if sqlite3_step(stmt) == SQLITE_ROW {
            count = Int(sqlite3_column_int(stmt, 0))
        }
        return count
    }
}

// MARK: - ZPL Builder

enum ZPLBuilder {
    static func dotsPerMM() -> Double { 203.0 / 25.4 } // 203 dpi default

    static func sizeInDots(for size: PackageStore.LabelSize, orientation: PackageStore.Orientation) -> (w: Int, h: Int) {
        let dpm = dotsPerMM()
        func mm(_ x: Double) -> Int { Int((x * dpm).rounded()) }
        let base: (Int, Int)
        switch size {
        case .mm100x100: base = (mm(100), mm(100))
        case .mm100x50:  base = (mm(100), mm(50))
        case .mm58x40:   base = (mm(58),  mm(40))
        case .mm62x29:   base = (mm(62),  mm(29))
        case .mm50x30:   base = (mm(50),  mm(30))
        case .mm40x20:   base = (mm(40),  mm(20))
        }
        if orientation == .portrait { return (base.0, base.1) } else { return (base.1, base.0) }
    }

    static func label(slot3: String, name: String, date: String, size: PackageStore.LabelSize, orientation: PackageStore.Orientation, fontScale: Double) -> String {
        let sz = sizeInDots(for: size, orientation: orientation)
        let pw = sz.w
        let ll = sz.h
        // Base font sizes scaled
        let bigH = Int((420.0 * fontScale).rounded())
        let bigW = bigH
        let midH = Int((70.0 * fontScale).rounded())
        let midW = midH
        let smallH = Int((55.0 * fontScale).rounded())
        let smallW = smallH

        return """
        ^XA
        ^CI28
        ^PW\(pw)
        ^LL\(ll)

        ^FO40,70
        ^A0N,\(bigH),\(bigW)
        ^FB\(pw - 80),1,0,C,0
        ^FD\(sanitize(name: slot3))^FS

        ^FO40,\(ll/2)
        ^A0N,\(midH),\(midW)
        ^FB\(pw - 80),1,0,C,0
        ^FD\(sanitize(name: name))^FS

        ^FO40,\(ll - 140)
        ^A0N,\(smallH),\(smallW)
        ^FB\(pw - 80),1,0,C,0
        ^FD\(sanitize(name: date))^FS

        ^XZ
        """
    }

    private static func sanitize(name: String) -> String {
        name.replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - PDF Builder for AirPrint

enum PDFLabelBuilder {
    static func pageSize(for paper: PackageStore.PaperSize) -> CGSize {
        // Sizes in points at 72 dpi (portrait)
        switch paper {
        case .a4:    return CGSize(width: 595, height: 842)   // 210 x 297 mm
        case .a5:    return CGSize(width: 420, height: 595)   // 148 x 210 mm
        case .a6:    return CGSize(width: 298, height: 420)   // 105 x 148 mm
        case .letter:return CGSize(width: 612, height: 792)   // 8.5 x 11 in
        case .legal: return CGSize(width: 612, height: 1008)  // 8.5 x 14 in
        }
    }

    static func renderPDF(slot3: String, name: String, date: String, paper: PackageStore.PaperSize, orientation: PackageStore.Orientation, scale: Double) -> Data {
        var page = pageSize(for: paper)
        if orientation == .landscape { page = CGSize(width: page.height, height: page.width) }

        let format = UIGraphicsPDFRendererFormat()
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: page), format: format)
        let data = renderer.pdfData { ctx in
            ctx.beginPage()
            let cg = UIGraphicsGetCurrentContext()
            cg?.setFillColor(UIColor.white.cgColor)
            cg?.fill(CGRect(origin: .zero, size: page))

            // Layout constants
            let margin: CGFloat = 36
            let content = CGRect(x: margin, y: margin, width: page.width - margin*2, height: page.height - margin*2)

            // Fonts scaled by `scale`
            let bigSize = CGFloat(180.0 * scale)
            let midSize = CGFloat(28.0 * scale)
            let smallSize = CGFloat(18.0 * scale)

            // Build attributed strings
            let bigAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: bigSize, weight: .bold),
                .foregroundColor: UIColor.black
            ]
            let midAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: midSize, weight: .semibold),
                .foregroundColor: UIColor.black
            ]
            let smallAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: smallSize, weight: .regular),
                .foregroundColor: UIColor.darkGray
            ]

            // Measure
            let big = NSAttributedString(string: slot3, attributes: bigAttrs)
            let mid = NSAttributedString(string: name, attributes: midAttrs)
            let sm  = NSAttributedString(string: date, attributes: smallAttrs)

            let bigSizeM = big.size()
            let midSizeM = mid.size()
            let smSizeM  = sm.size()

            // Vertical stack centered
            let spacing: CGFloat = 16 * scale
            let totalH = bigSizeM.height + spacing + midSizeM.height + spacing + smSizeM.height
            var y = content.midY - totalH/2

            // Draw centered
            func drawCentered(_ str: NSAttributedString, y: CGFloat) -> CGFloat {
                let w = str.size().width
                let x = content.midX - w/2
                str.draw(at: CGPoint(x: max(content.minX, x), y: y))
                return y + str.size().height
            }

            y = drawCentered(big, y: y)
            y += spacing
            y = drawCentered(mid, y: y)
            y += spacing
            _ = drawCentered(sm, y: y)
        }
        return data
    }
}

struct BrandHeaderView: View {
    var body: some View {
        HStack(spacing: 10) {
            Image("BrandLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 28, height: 28)
                .shadow(color: Color.black.opacity(0.15), radius: 2, x: 0, y: 1)
            Spacer(minLength: 6)
            Text("Me&Me GmbH")
                .font(.headline.weight(.bold))
                .foregroundStyle(.primary)
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Me and Me GmbH")
    }
}

struct SplashView: View {
    @State private var show = false

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            VStack(spacing: 16) {
                Image("BrandLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 160, height: 160)
                    .shadow(color: .black.opacity(0.15), radius: 4, x: 0, y: 2)
                    .opacity(show ? 1 : 0)
                    .scaleEffect(show ? 1 : 0.92)
                Text("Me&Me GmbH")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(.primary)
                    .opacity(show ? 1 : 0)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) { show = true }
        }
    }
}

// MARK: - Bluetooth Printer (CoreBluetooth minimal)

import CoreBluetooth

final class BluetoothPrinterManager: NSObject, ObservableObject {
    static let shared = BluetoothPrinterManager()

    @Published var isScanning = false
    @Published var discovered: [CBPeripheral] = []
    @Published var connectedPeripheral: CBPeripheral?
    @Published var status: String = ""

    private var central: CBCentralManager!
    private var writeCharacteristic: CBCharacteristic?
    private var connectContinuation: CheckedContinuation<Void, Error>?

    // Common BLE UART/Serial service/characteristic UUIDs used by some printers/adapters
    private let candidateServiceUUIDs: [CBUUID] = [
        CBUUID(string: "0000FFE0-0000-1000-8000-00805F9B34FB"),
        CBUUID(string: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    ]
    private let candidateWriteCharacteristicUUIDs: [CBUUID] = [
        CBUUID(string: "0000FFE1-0000-1000-8000-00805F9B34FB"),
        CBUUID(string: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
    ]

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func startScan() {
        guard central.state == .poweredOn else { return }
        status = "Suche…"
        discovered.removeAll()
        isScanning = true
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func stopScan() {
        isScanning = false
        central.stopScan()
    }

    func connect(to peripheral: CBPeripheral) async throws {
        stopScan()
        peripheral.delegate = self
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            self.connectContinuation = cont
            self.central.connect(peripheral, options: nil)
        }
    }

    func write(_ data: Data) async throws {
        guard let p = connectedPeripheral, let ch = writeCharacteristic else {
            throw NSError(domain: "PaketLager", code: 310, userInfo: [NSLocalizedDescriptionKey: "Bluetooth nicht verbunden oder Merkmal nicht gefunden."])
        }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            p.writeValue(data, for: ch, type: .withResponse)
            // Naiv: direkt erfolgreich melden. Für robuste Implementierung: didWriteValueFor beobachten.
            cont.resume()
        }
    }
}

extension BluetoothPrinterManager: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            status = "Bluetooth an."
        case .poweredOff:
            status = "Bluetooth aus."
        default:
            break
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        if !discovered.contains(where: { $0.identifier == peripheral.identifier }) {
            discovered.append(peripheral)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        status = "Verbunden mit \(peripheral.name ?? peripheral.identifier.uuidString)"
        connectedPeripheral = peripheral
        peripheral.discoverServices(candidateServiceUUIDs)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        status = "Verbindung fehlgeschlagen: \(error?.localizedDescription ?? "Unbekannt")"
        connectContinuation?.resume(throwing: error ?? NSError(domain: "PaketLager", code: 311, userInfo: [NSLocalizedDescriptionKey: "BT-Verbindung fehlgeschlagen"]))
        connectContinuation = nil
    }
}

extension BluetoothPrinterManager: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error = error { status = "Service-Fehler: \(error.localizedDescription)"; return }
        guard let services = peripheral.services else { return }
        for s in services where candidateServiceUUIDs.contains(s.uuid) {
            peripheral.discoverCharacteristics(candidateWriteCharacteristicUUIDs, for: s)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error = error { status = "Merkmal-Fehler: \(error.localizedDescription)"; return }
        guard let chars = service.characteristics else { return }
        for ch in chars where candidateWriteCharacteristicUUIDs.contains(ch.uuid) {
            writeCharacteristic = ch
            connectContinuation?.resume()
            connectContinuation = nil
            break
        }
    }
}

enum BluetoothPrinter {
    static func send(payload: String, deviceIdentifier: String) async throws {
        let mgr = BluetoothPrinterManager.shared
        // Falls bereits verbunden und Merkmal vorhanden, direkt senden
        if let connected = mgr.connectedPeripheral, connected.identifier.uuidString == deviceIdentifier, mgr.connectedPeripheral != nil {
            let data = payload.data(using: .utf8) ?? Data()
            try await mgr.write(data)
            return
        }
        // Andernfalls versuchen wir, Gerät per Identifier zu finden und zu verbinden
        guard let uuid = UUID(uuidString: deviceIdentifier) else {
            throw NSError(domain: "PaketLager", code: 312, userInfo: [NSLocalizedDescriptionKey: "Ungültige Geräte-ID."])
        }
        // Start Scan kurzzeitig, um das Peripheral zu finden
        mgr.startScan()
        // Warten wir kurz, um Funde zu sammeln
        try await Task.sleep(nanoseconds: 1_000_000_000)
        mgr.stopScan()
        guard let target = mgr.discovered.first(where: { $0.identifier == uuid }) else {
            throw NSError(domain: "PaketLager", code: 313, userInfo: [NSLocalizedDescriptionKey: "Bluetooth-Gerät nicht gefunden."])
        }
        try await mgr.connect(to: target)
        let data = payload.data(using: .utf8) ?? Data()
        try await mgr.write(data)
    }
}

// MARK: - Raw TCP Printer (Network.framework)

enum RawTCPPrinter {
    static func send(host: String, port: Int, payload: String) async throws {
        let h = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !h.isEmpty else {
            throw NSError(domain: "PaketLager", code: 2, userInfo: [NSLocalizedDescriptionKey: "Drucker-IP ist leer."])
        }

        let nwHost = NWEndpoint.Host(h)
        let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) ?? 9100

        let connection = NWConnection(host: nwHost, port: nwPort, using: .tcp)
        defer { connection.cancel() }

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let data = payload.data(using: .utf8) ?? Data()
                    connection.send(content: data, completion: .contentProcessed { err in
                        if let err { cont.resume(throwing: err) }
                        else { cont.resume() }
                    })
                case .failed(let err):
                    cont.resume(throwing: err)
                default:
                    break
                }
            }
            connection.start(queue: .global())
        }
    }
}

// MARK: - Vision OCR (on-device)

enum VisionOCR {
    static func recognizeText(from image: UIImage) async throws -> String {
        guard let cg = image.cgImage else {
            throw NSError(domain: "PaketLager", code: 10, userInfo: [NSLocalizedDescriptionKey: "Ungültiges Bild."])
        }

        return try await withCheckedThrowingContinuation { cont in
            let request = VNRecognizeTextRequest { req, err in
                if let err { cont.resume(throwing: err); return }
                let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
                let lines = obs.compactMap { $0.topCandidates(1).first?.string }
                cont.resume(returning: lines.joined(separator: "\n"))
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["de-DE", "en-US"]

            let handler = VNImageRequestHandler(cgImage: cg, options: [:])
            do { try handler.perform([request]) }
            catch { cont.resume(throwing: error) }
        }
    }
}

// MARK: - Parser

enum FieldParser {
    static func parse(_ raw: String) -> ExtractedFields {
        var f = ExtractedFields()
        let lines = raw
            .replacingOccurrences(of: "\t", with: " ")
            .split(separator: "\n")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        let plzRegex = try? NSRegularExpression(pattern: #"(\b\d{5}\b)\s+(.+)$"#)
        var plzIndex: Int?

        for (i, line) in lines.enumerated() {
            let ns = line as NSString
            let range = NSRange(location: 0, length: ns.length)
            if let m = plzRegex?.firstMatch(in: line, range: range) {
                f.postalCode = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                f.city = ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespacesAndNewlines)
                plzIndex = i
                break
            }
        }

        if let idx = plzIndex, idx > 0 {
            let addrLine = lines[idx - 1]
            let parts = addrLine.split(separator: " ").map(String.init)
            if parts.count >= 2 {
                f.houseNo = parts.last ?? ""
                f.street = parts.dropLast().joined(separator: " ")
            } else {
                f.street = addrLine
            }
        }

        for line in lines.prefix(6) {
            if looksLikeNoise(line) { continue }
            let words = line.split(separator: " ").map(String.init)
            if words.count >= 2 {
                f.firstName = words.first ?? ""
                f.lastName = words.dropFirst().joined(separator: " ")
                break
            }
        }
        return f
    }

    private static func looksLikeNoise(_ line: String) -> Bool {
        let l = line.lowercased()
        if l.contains("tracking") || l.contains("sendung") || l.contains("paket") { return true }
        if l.contains("tel") || l.contains("phone") { return true }
        if l.range(of: #"\b\d{10,}\b"#, options: .regularExpression) != nil { return true }
        return false
    }
}

// MARK: - Camera Picker

struct CameraPicker: UIViewControllerRepresentable {
    @Environment(\.dismiss) private var dismiss
    let onImage: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        p.allowsEditing = false
        return p
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onImage: onImage, dismiss: dismiss) }

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let onImage: (UIImage) -> Void
        let dismiss: DismissAction

        init(onImage: @escaping (UIImage) -> Void, dismiss: DismissAction) {
            self.onImage = onImage
            self.dismiss = dismiss
        }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
            if let img = info[.originalImage] as? UIImage { onImage(img) }
            dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { dismiss() }
    }
}

// MARK: - Views

struct ReceiveView: View {
    @EnvironmentObject private var store: PackageStore

    @State private var showCamera = false
    @State private var image: UIImage?
    @State private var ocrText: String = ""
    @State private var fields = ExtractedFields()

    @State private var isWorking = false
    @State private var status: String?
    @State private var showSuccessAlert = false

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Button { showCamera = true } label: {
                        Label("Foto aufnehmen", systemImage: "camera")
                    }

                    if let image = image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 220)
                            .cornerRadius(8)
                    }

                    if isWorking { ProgressView("Verarbeite…") }
                    if let status = status { Text(status).foregroundStyle(.secondary) }
                }

                Section("Erkannte Daten (bitte prüfen)") {
                    TextField("Vorname", text: $fields.firstName)
                    TextField("Nachname", text: $fields.lastName)
                    TextField("Straße", text: $fields.street)
                    TextField("Hausnr.", text: $fields.houseNo)
                    TextField("PLZ", text: $fields.postalCode).keyboardType(.numberPad)
                    TextField("Ort", text: $fields.city)
                }

                Section {
                    Button {
                        Task { await saveAndPrint() }
                    } label: {
                        Label("Speichern & Drucken", systemImage: "printer")
                    }
                    .disabled(!canSave || isWorking)
                }

                if !ocrText.isEmpty {
                    Section("OCR Rohtext (nur zur Kontrolle)") {
                        Text(ocrText).font(.footnote).textSelection(.enabled)
                    }
                }
            }
            .alert("Erfolgreich gespeichert", isPresented: $showSuccessAlert) {
                Button("OK", role: .cancel) { }
            } message: {
                Text("Der Datensatz wurde aufgenommen und gedruckt.")
            }
            .navigationTitle("Paket annehmen")
            //.toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            //.toolbarBackgroundVisibility(.visible, for: .navigationBar)
            //.toolbar {
            //    ToolbarItem(placement: .topBarLeading) {
            //        BrandHeaderView()
            //    }
            //}
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { img in
                image = img
                Task { await runOCR(img) }
            }
        }
    }

    private var canSave: Bool { true }

    private func runOCR(_ img: UIImage) async {
        isWorking = true
        status = "OCR läuft lokal…"
        do {
            let text = try await VisionOCR.recognizeText(from: img)
            ocrText = text
            fields = FieldParser.parse(text)
            status = "OCR fertig. Bitte kurz prüfen."
        } catch {
            status = "OCR Fehler: \(error.localizedDescription)"
        }
        isWorking = false
    }

    private func saveAndPrint() async {
        isWorking = true
        status = "Speichere…"
        do {
            let pkg = try store.createPackage(fields: fields, arrivalAt: Date())
            status = "Gespeichert als #\(pkg.slot3). Drucke…"
            
            switch store.printerMode {
            case .label:
                let zpl = ZPLBuilder.label(slot3: pkg.slot3, name: pkg.fullName, date: pkg.formattedDateDE, size: store.labelSize, orientation: store.orientation, fontScale: store.fontScale)
                do {
                    try await RawTCPPrinter.send(host: store.printerIP, port: store.printerPort, payload: zpl)
                    status = "Gedruckt: #\(pkg.slot3)"
                } catch {
                    do { try store.enqueuePendingPrint(payload: zpl) } catch { }
                    status = "Druckfehler: \(error.localizedDescription). In Warteschlange gespeichert."
                }
            case .bluetooth:
                let zpl = ZPLBuilder.label(slot3: pkg.slot3, name: pkg.fullName, date: pkg.formattedDateDE, size: store.labelSize, orientation: store.orientation, fontScale: store.fontScale)
                do {
                    try await BluetoothPrinter.send(payload: zpl, deviceIdentifier: store.bluetoothDeviceIdentifier)
                    status = "Bluetooth: gedruckt."
                } catch {
                    do { try store.enqueuePendingPrint(payload: zpl) } catch { }
                    status = "Bluetooth-Druckfehler: \(error.localizedDescription). In Warteschlange gespeichert."
                }
            case .airPrint:
                let pdf = PDFLabelBuilder.renderPDF(
                    slot3: pkg.slot3,
                    name: pkg.fullName,
                    date: pkg.formattedDateDE,
                    paper: store.paperSize,
                    orientation: store.orientation,
                    scale: store.fontScale
                )
                await MainActor.run {
                    let controller = UIPrintInteractionController.shared
                    let info = UIPrintInfo(dictionary: nil)
                    info.outputType = .general
                    info.jobName = "Paketlager #\(pkg.slot3)"
                    controller.printInfo = info
                    controller.showsNumberOfCopies = true
                    controller.printingItem = pdf
                    controller.present(animated: true) { _, completed, error in
                        DispatchQueue.main.async {
                            if let error = error {
                                status = "AirPrint Fehler: \(error.localizedDescription)"
                            } else {
                                status = completed ? "AirPrint: gedruckt." : "AirPrint: abgebrochen."
                            }
                        }
                    }
                }
            }

            image = nil
            ocrText = ""
            fields = ExtractedFields()
            showSuccessAlert = true
        } catch {
            status = "Fehler: \(error.localizedDescription)"
        }
        isWorking = false
    }
}

struct SearchView: View {
    @EnvironmentObject private var store: PackageStore
    @State private var query = ""
    @State private var results: [PackageRecord] = []
    @State private var errorMsg: String?
    @State private var selected: PackageRecord?

    @State private var sortBy: SortBy = .arrival
    @State private var sortAscending: Bool = false

    enum SortBy: String, CaseIterable, Identifiable {
        case number = "Nummer"
        case arrival = "Ankunft"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                HStack {
                    TextField("Name oder Adresse…", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: query) { oldValue, newValue in
                            runSearch()
                        }
                }
                .padding(.horizontal)

                HStack {
                    Picker("Sortieren nach", selection: $sortBy) {
                        ForEach(SortBy.allCases) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)

                    Toggle(isOn: $sortAscending) {
                        Text(sortAscending ? "Aufsteigend" : "Absteigend")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .toggleStyle(.switch)
                }
                .padding(.horizontal)
                .onChange(of: sortBy) { _, _ in applySort() }
                .onChange(of: sortAscending) { _, _ in applySort() }

                if let errorMsg = errorMsg { Text(errorMsg).foregroundStyle(.red).padding(.horizontal) }

                List(results) { pkg in
                    Button { selected = pkg } label: {
                        HStack {
                            Text(pkg.slot3)
                                .font(.system(size: 40, weight: .bold, design: .rounded))
                                .frame(width: 90, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(pkg.fullName).font(.headline)
                                Text("\(pkg.addressLine), \(pkg.postalCode) \(pkg.city)")
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Text(pkg.formattedDateTimeDE)
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            confirmDelete(pkg)
                        } label: {
                            Label("Löschen", systemImage: "trash")
                        }
                    }
                }
                .listStyle(.plain)
            }
            .navigationTitle("Paket finden")
            //.toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            //.toolbarBackgroundVisibility(.visible, for: .navigationBar)
            //.toolbar {
            //    ToolbarItem(placement: .topBarLeading) {
            //        BrandHeaderView()
            //    }
            //}
            .onAppear { runSearch() }
            .sheet(item: $selected) { pkg in
                PackageDetailSheet(pkg: pkg)
            }
        }
    }

    private func runSearch() {
        do {
            errorMsg = nil
            let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if q.isEmpty {
                // Load all packages when no query is provided
                results = try store.search(q: "%")
                applySort()
            } else {
                results = try store.search(q: q)
                applySort()
            }
        } catch {
            errorMsg = error.localizedDescription
            results = []
        }
    }

    private func applySort() {
        switch sortBy {
        case .number:
            results.sort { a, b in
                sortAscending ? (a.slot < b.slot) : (a.slot > b.slot)
            }
        case .arrival:
            results.sort { a, b in
                sortAscending ? (a.arrivalAt < b.arrivalAt) : (a.arrivalAt > b.arrivalAt)
            }
        }
    }

    private func confirmDelete(_ item: PackageRecord) {
        do {
            try store.deletePackage(id: item.id)
            // Remove from current results and re-run search to refresh
            results.removeAll { $0.id == item.id }
        } catch {
            errorMsg = error.localizedDescription
        }
    }
}

struct PackageDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var store: PackageStore

    let pkg: PackageRecord
    @State private var status: String?
    @State private var isWorking = false

    var body: some View {
        NavigationView {
            Form {
                Section("Lagernummer") {
                    Text(pkg.slot3)
                        .font(.system(size: 64, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                Section("Empfänger") {
                    Text(pkg.fullName)
                    Text("\(pkg.addressLine)\n\(pkg.postalCode) \(pkg.city)")
                }
                Section("Ankunft") { Text(pkg.formattedDateTimeDE) }

                if let status = status { Section { Text(status).foregroundStyle(.secondary) } }

                Section {
                    Button {
                        Task { await reprint() }
                    } label: { Label("Label erneut drucken", systemImage: "printer") }
                    .disabled(isWorking)

                    Button(role: .destructive) {
                        pickup()
                    } label: { Label("Abholung bestätigen (löschen)", systemImage: "checkmark.circle") }
                    .disabled(isWorking)
                }
            }
            .navigationTitle("Details")
            //.toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            //.toolbarBackgroundVisibility(.visible, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Schließen") { dismiss() } } }
        }
    }

    private func reprint() async {
        isWorking = true
        status = "Drucke…"
        do {
            try await store.printLabel(for: pkg)
            status = "Gedruckt."
        } catch {
            status = "Druckfehler: \(error.localizedDescription)"
        }
        isWorking = false
    }

    private func pickup() {
        isWorking = true
        status = "Lösche…"
        do {
            try store.deletePackage(id: pkg.id)
            status = "Gelöscht. Nummer frei."
            dismiss()
        } catch {
            status = "Fehler: \(error.localizedDescription)"
            isWorking = false
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: PackageStore
    @State private var ip: String = ""
    @State private var portText: String = "9100"
    @State private var status: String?
    @State private var isWorking = false

    var body: some View {
        NavigationView {
            Form {
                Section("Drucker (WLAN Direktdruck)") {
                    TextField("Drucker IP (z.B. 192.168.1.50)", text: $ip)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Port", text: $portText).keyboardType(.numberPad)

                    Button {
                        store.savePrinterSettings(ip: ip, port: Int(portText) ?? 9100)
                        status = "Gespeichert."
                    } label: { Label("Speichern", systemImage: "tray.and.arrow.down") }
                }

                Section("Druckmodus") {
                    Picker("Modus", selection: $store.printerMode) {
                        Text("Labeldrucker (ZPL)").tag(PackageStore.PrinterMode.label)
                        Text("Normaler Drucker (AirPrint)").tag(PackageStore.PrinterMode.airPrint)
                        Text("Bluetooth-Drucker").tag(PackageStore.PrinterMode.bluetooth)
                    }
                    .pickerStyle(.segmented)
                }

                if store.printerMode == .label {
                    Section("Labelgröße & Layout") {
                        Picker("Labelgröße", selection: $store.labelSize) {
                            ForEach(PackageStore.LabelSize.allCases) { s in Text(s.rawValue).tag(s) }
                        }
                        Picker("Ausrichtung", selection: $store.orientation) {
                            ForEach(PackageStore.Orientation.allCases) { o in Text(o.rawValue).tag(o) }
                        }
                        Picker("Skalierung", selection: $store.scaleMode) {
                            ForEach(PackageStore.ScaleMode.allCases) { m in Text(m.rawValue).tag(m) }
                        }
                        HStack {
                            Text("Schriftgröße")
                            Slider(value: $store.fontScale, in: 0.8...1.2, step: 0.05)
                            Text("\(Int(store.fontScale * 100))%")
                        }
                    }
                } else if store.printerMode == .airPrint {
                    Section("Papier & Layout") {
                        Picker("Papiergröße", selection: $store.paperSize) {
                            ForEach(PackageStore.PaperSize.allCases) { s in Text(s.rawValue).tag(s) }
                        }
                        Picker("Ausrichtung", selection: $store.orientation) {
                            ForEach(PackageStore.Orientation.allCases) { o in Text(o.rawValue).tag(o) }
                        }
                        Picker("Skalierung", selection: $store.scaleMode) {
                            ForEach(PackageStore.ScaleMode.allCases) { m in Text(m.rawValue).tag(m) }
                        }
                        HStack {
                            Text("Schriftgröße")
                            Slider(value: $store.fontScale, in: 0.8...1.2, step: 0.05)
                            Text("\(Int(store.fontScale * 100))%")
                        }
                        Text("Hinweis: AirPrint-Druckvorschau wird beim Drucken angezeigt.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                if store.printerMode == .bluetooth {
                    Section("Bluetooth-Drucker") {
                        let bt = BluetoothPrinterManager.shared
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Button(bt.isScanning ? "Stop" : "Scannen") {
                                    if bt.isScanning { bt.stopScan() } else { bt.startScan() }
                                }
                                .buttonStyle(.bordered)
                                Text(bt.status).font(.footnote).foregroundStyle(.secondary)
                            }
                            if bt.discovered.isEmpty {
                                Text("Keine Geräte gefunden.").font(.footnote).foregroundStyle(.secondary)
                            } else {
                                ForEach(bt.discovered, id: \ .identifier) { p in
                                    Button(action: {
                                        store.bluetoothDeviceName = p.name ?? "Unbekannt"
                                        store.bluetoothDeviceIdentifier = p.identifier.uuidString
                                    }) {
                                        HStack {
                                            VStack(alignment: .leading) {
                                                Text(p.name ?? "Unbekannt")
                                                Text(p.identifier.uuidString).font(.caption2).foregroundStyle(.secondary)
                                            }
                                            Spacer()
                                            if store.bluetoothDeviceIdentifier == p.identifier.uuidString {
                                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                            }
                                        }
                                    }
                                }
                            }
                            TextField("Gerätename (optional)", text: $store.bluetoothDeviceName)
                            TextField("Geräte-ID (UUID / Identifier)", text: $store.bluetoothDeviceIdentifier)
                            Text("Hinweis: Einige Drucker erfordern ein Hersteller-SDK. Diese BLE-Implementierung funktioniert nur, wenn das Gerät eine serielle Write-Charakteristik bereitstellt.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    Button { Task { await testPrint() } } label: {
                        Label("Testdruck", systemImage: "printer.fill")
                    }
                    .disabled(isWorking)
                }

                if let status = status { Section { Text(status).foregroundStyle(.secondary) } }

                Section("Info") {
                    Text("Label: 100×100mm – Nummer sehr groß + Name + Datum.")
                    Text("Beim ersten Drucken fragt iOS einmal nach „Lokales Netzwerk erlauben“.")
                    Text("Fehlgeschlagene Drucke werden in die Warteschlange gelegt und können später gesendet werden.")
                }
            }
            .navigationTitle("Einstellungen")
            //.toolbarBackground(.ultraThinMaterial, for: .navigationBar)
            //.toolbarBackgroundVisibility(.visible, for: .navigationBar)
            //.toolbar {
            //    ToolbarItem(placement: .topBarLeading) {
            //        BrandHeaderView()
            //    }
            //}
            .onAppear {
                ip = store.printerIP
                portText = "\(store.printerPort)"
            }
        }
    }

    private func testPrint() async {
        isWorking = true
        status = "Teste Druck…"
        do {
            store.savePrinterSettings(ip: ip, port: Int(portText) ?? 9100)
            switch store.printerMode {
            case .label:
                let zpl = ZPLBuilder.label(slot3: "123", name: "Test Mustermann", date: "21.02.2026", size: store.labelSize, orientation: store.orientation, fontScale: store.fontScale)
                try await RawTCPPrinter.send(host: store.printerIP, port: store.printerPort, payload: zpl)
                status = "Testdruck gesendet."
            case .bluetooth:
                let zpl = ZPLBuilder.label(slot3: "123", name: "Test Mustermann", date: "21.02.2026", size: store.labelSize, orientation: store.orientation, fontScale: store.fontScale)
                try await BluetoothPrinter.send(payload: zpl, deviceIdentifier: store.bluetoothDeviceIdentifier)
                status = "Bluetooth Test: gesendet."
            case .airPrint:
                let pdf = PDFLabelBuilder.renderPDF(
                    slot3: "123",
                    name: "Test Mustermann",
                    date: "21.02.2026",
                    paper: store.paperSize,
                    orientation: store.orientation,
                    scale: store.fontScale
                )
                await MainActor.run {
                    let controller = UIPrintInteractionController.shared
                    let info = UIPrintInfo(dictionary: nil)
                    info.outputType = .general
                    info.jobName = "Paketlager Test"
                    controller.printInfo = info
                    controller.showsNumberOfCopies = true
                    controller.printingItem = pdf
                    controller.present(animated: true) { _, completed, error in
                        DispatchQueue.main.async {
                            if let error = error {
                                status = "AirPrint Fehler: \(error.localizedDescription)"
                            } else {
                                status = completed ? "AirPrint Test: gedruckt." : "AirPrint Test: abgebrochen."
                            }
                        }
                    }
                }
            }
        } catch {
            status = "Fehler: \(error.localizedDescription)"
        }
        isWorking = false
    }
}

