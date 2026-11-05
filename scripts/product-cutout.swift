// Lifts the product out of a photo with macOS Vision's subject segmentation, so every
// product in the README demo can be set on the same backdrop with the same shadow.
// macOS 14+:
//
//   swift scripts/product-cutout.swift <in.jpg> <out.png>
//
// The PNG keeps only the subject, cropped to it, with a soft alpha edge.

import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: product-cutout <in> <out.png>\n".data(using: .utf8)!)
  exit(2)
}
guard let input = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("can't read \(args[1])\n".data(using: .utf8)!)
  exit(1)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: input)
try handler.perform([request])
guard let result = request.results?.first, !result.allInstances.isEmpty else {
  FileHandle.standardError.write("no subject found in \(args[1])\n".data(using: .utf8)!)
  exit(1)
}

let buffer = try result.generateMaskedImage(
  ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true)
let cut = CIImage(cvPixelBuffer: buffer)
let context = CIContext()
guard let cg = context.createCGImage(cut, from: cut.extent) else { exit(1) }
let rep = NSBitmapImageRep(cgImage: cg)
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: args[2]))
print("\(args[2]) \(cg.width)x\(cg.height)")
