import protobuf from 'protobufjs'
// 加载 descriptor 扩展：使 Root.fromDescriptor / FileDescriptorSet 可用
import pbDescriptor from 'protobufjs/ext/descriptor'

export type SchemaSource =
  | { kind: 'proto'; text: string }
  | { kind: 'descriptor'; bytes: Uint8Array; fileName?: string }

export interface ParsedSchema {
  root: protobuf.Root
  types: string[] // 全限定名（a.b.MessageName）
  files: string[] // descriptor 里包含的文件名（仅 kind=descriptor 有）
}

/**
 * 解析 .proto 文本。
 * 不走文件系统（protobufjs 默认按路径解析 import），把输入当成单文件处理；
 * import 语句暂不支持。若需要 import，请用 .pb 描述符。
 */
export function parseProto(source: string): ParsedSchema {
  if (!source.trim()) throw new Error('空的 .proto')
  const parsed = protobuf.parse(source, { keepCase: false })
  const root = parsed.root
  root.resolveAll()
  const types: string[] = []
  collectMessageTypes(root, types)
  return { root, types, files: [] }
}

/**
 * 从 FileDescriptorSet 二进制（.pb / .desc）加载 schema。
 * 这是 `protoc --descriptor_set_out=x.pb` 的输出，自带所有 import。
 *
 * 注意：protobufjs 的 Root.fromDescriptor 有个 bug —— 把 map 字段当成普通 repeated message 处理，
 * 并错把 parent 的 options.map_entry 标成 true。我们在此做修正。
 */
export function parseDescriptor(bytes: Uint8Array): ParsedSchema {
  if (!bytes || bytes.length === 0) throw new Error('空的描述符字节流')
  const FDS: any = (pbDescriptor as any).FileDescriptorSet
  if (!FDS) throw new Error('protobufjs descriptor 扩展未加载')
  const decoded = FDS.decode(bytes)
  const root: protobuf.Root = (protobuf.Root as any).fromDescriptor(decoded)
  root.resolveAll()
  fixMapFields(root)
  root.resolveAll()
  const types: string[] = []
  collectMessageTypes(root, types)
  const files: string[] = Array.isArray(decoded?.file)
    ? decoded.file.map((f: any) => f.name).filter(Boolean)
    : []
  return { root, types, files }
}

/**
 * 修复 protobufjs fromDescriptor 的 map 识别问题：
 * - 把被错误标在父 type 上的 options.map_entry 清掉
 * - 把父 type 里指向 Entry 的 repeated 字段替换成 MapField
 */
function fixMapFields(ns: protobuf.ReflectionObject) {
  if (ns instanceof protobuf.Type) {
    // 清掉错误的 map_entry 标记（只有真正的 entry 消息自己才应保留）
    if (
      ns.options &&
      (ns.options as any).map_entry &&
      !(ns.fields.key && ns.fields.value && Object.keys(ns.fields).length === 2)
    ) {
      delete (ns.options as any).map_entry
    }

    // 收集本 type 下所有 entry 子消息
    const entries: Record<string, protobuf.Type> = {}
    for (const nested of (ns as any).nestedArray || []) {
      if (
        nested instanceof protobuf.Type &&
        nested.options &&
        ((nested.options as any).map_entry === true) &&
        nested.fields.key &&
        nested.fields.value
      ) {
        entries[nested.name] = nested
      }
    }

    // 扫自己的 field，把 repeated <Entry> 替换成 MapField
    for (const fname of Object.keys(ns.fields)) {
      const f: any = ns.fields[fname]
      if (f instanceof protobuf.MapField) continue
      if (!f.repeated) continue
      // f.type 可能是短名或带 package 的名字；通过 resolvedType 更稳
      const resolved = f.resolvedType
      if (!(resolved instanceof protobuf.Type)) continue
      const entry = resolved.name && entries[resolved.name]
      if (!entry) continue
      if (entry !== resolved) continue // 指向的确实是本 type 下的那个 entry

      const keyType = entry.fields.key.type
      const valueField = entry.fields.value
      const valueType = valueField.resolvedType
        ? valueField.resolvedType.fullName.replace(/^\./, '')
        : valueField.type

      // 新 MapField 替换
      const mf = new protobuf.MapField(
        f.name,
        f.id,
        keyType,
        valueType,
        f.options,
        f.comment,
      )
      ns.remove(f)
      ns.add(mf)
    }
  }

  if (ns instanceof protobuf.Namespace) {
    for (const child of (ns as any).nestedArray || []) {
      fixMapFields(child)
    }
  }
}

function collectMessageTypes(obj: protobuf.ReflectionObject, out: string[]) {
  if (obj instanceof protobuf.Type) {
    out.push(obj.fullName.replace(/^\./, ''))
  }
  if (obj instanceof protobuf.Namespace) {
    for (const nested of obj.nestedArray) {
      collectMessageTypes(nested, out)
    }
  }
}

export function lookupType(root: protobuf.Root, fullName: string): protobuf.Type {
  return root.lookupType(fullName)
}

export function encode(
  root: protobuf.Root,
  fullName: string,
  json: unknown,
): Uint8Array {
  const type = root.lookupType(fullName)
  // 先 fromObject：把 enum 字符串、int64 字符串、默认值等归一化成合法字段；
  // 再 verify 校验（此时检查的是归一化后的对象，能接受 Long / 整数等实际需要的类型）。
  const msg = type.fromObject(json as any)
  const err = type.verify(msg)
  if (err) throw new Error(err)
  return type.encode(msg).finish()
}

export function decode(
  root: protobuf.Root,
  fullName: string,
  bytes: Uint8Array,
): unknown {
  const type = root.lookupType(fullName)
  const msg = type.decode(bytes)
  return type.toObject(msg, {
    longs: String,
    bytes: String,
    enums: String,
    defaults: false,
    arrays: true,
    objects: true,
  })
}

/**
 * 当用户没指定消息类型 / 解码失败时的兜底：盲解析字节流为字段（tag + wire type + raw）。
 * 用于 hex/base64 → 查看 Protobuf 粗结构。
 */
export function rawDecode(bytes: Uint8Array): Array<{
  field: number
  wire: number
  wireName: string
  value: any
}> {
  const out: Array<{ field: number; wire: number; wireName: string; value: any }> = []
  const reader: any = protobuf.Reader.create(bytes)
  while (reader.pos < reader.len) {
    const tag = reader.uint32()
    const field = tag >>> 3
    const wire = tag & 7
    let value: any
    switch (wire) {
      case 0: // varint
        value = reader.int64().toString()
        break
      case 1: {
        // 64-bit 固定
        const buf: Uint8Array = reader.buf.slice(reader.pos, reader.pos + 8)
        reader.pos += 8
        value = '0x' + buf2hex(buf)
        break
      }
      case 2: // length-delimited
        value = reader.bytes()
        break
      case 5: {
        // 32-bit 固定
        const buf: Uint8Array = reader.buf.slice(reader.pos, reader.pos + 4)
        reader.pos += 4
        value = '0x' + buf2hex(buf)
        break
      }
      default:
        throw new Error(`未知 wire type: ${wire}`)
    }
    out.push({ field, wire, wireName: wireNames[wire] || '?', value })
  }
  return out
}

const wireNames: Record<number, string> = {
  0: 'varint',
  1: '64-bit',
  2: 'length-delimited',
  5: '32-bit',
}

function buf2hex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

// ---- 示例 ----
export const EXAMPLE_PROTO = `syntax = "proto3";

package demo;

message Person {
  string name = 1;
  int32 age = 2;
  repeated string tags = 3;
  Address address = 4;
  map<string, string> attrs = 5;
  Status status = 6;
}

message Address {
  string city = 1;
  string street = 2;
  int32 zip = 3;
}

enum Status {
  UNKNOWN = 0;
  ACTIVE = 1;
  ARCHIVED = 2;
}
`

export const EXAMPLE_JSON = `{
  "name": "Alice",
  "age": 30,
  "tags": ["dev", "ops"],
  "address": { "city": "Shanghai", "street": "Pudong", "zip": 200120 },
  "attrs": { "role": "admin", "team": "platform" },
  "status": "ACTIVE"
}`
