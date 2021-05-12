import draco3d from "draco3d";
import draco3dWasm from "draco3d/draco_decoder.wasm";

const decodeGeometry = (draco, decoder, json, binary, dracoCompression) => {
  const { bufferView: bufferViewIndex } = dracoCompression;
  const bufferView = json.bufferViews[bufferViewIndex];
  const buffer = new draco.DecoderBuffer();
  const data = new Int8Array(binary.buffer, binary.byteOffset + (bufferView.byteOffset || 0), bufferView.byteLength);
  buffer.Init(data, bufferView.byteLength);
  const geometryType = decoder.GetEncodedGeometryType(buffer);

  let dracoGeometry;
  let status;
  if (geometryType === draco.TRIANGULAR_MESH) {
    dracoGeometry = new draco.Mesh();
    status = decoder.DecodeBufferToMesh(buffer, dracoGeometry);
  } else if (geometryType === draco.POINT_CLOUD) {
    dracoGeometry = new draco.PointCloud();
    status = decoder.DecodeBufferToPointCloud(buffer, dracoGeometry);
  } else {
    const errorMsg = "Error: Unknown geometry type.";
    console.error(errorMsg);
  }

  if (!status.ok() || dracoGeometry.ptr === 0) {
    throw new Error(`Decoding failed: ${status.error_msg()}`);
  }

  draco.destroy(buffer);

  return dracoGeometry;
};

const decodeAttributes = (draco, decoder, dracoGeometry, attributes) => {
  const accessors = [];
  for (const attributeName in attributes) {
    const attributeId = attributes[attributeName];
    const attribute = decoder.GetAttributeByUniqueId(dracoGeometry, attributeId);

    const numComponents = attribute.num_components();
    const numPoints = dracoGeometry.num_points();
    const numValues = numPoints * numComponents;
    const attributeType = Float32Array;
    const byteLength = numValues * attributeType.BYTES_PER_ELEMENT;
    const dataType = draco.DT_FLOAT32;

    // eslint-disable-next-line no-underscore-dangle
    const ptr = draco._malloc(byteLength);

    decoder.GetAttributeDataArrayForAllPoints(dracoGeometry, attribute, dataType, byteLength, ptr);
    const array = new attributeType(draco.HEAPF32.buffer, ptr, numValues).slice();

    // eslint-disable-next-line no-underscore-dangle
    draco._free(ptr);

    accessors.push(array);
  }
  return accessors;
};

const decodeIndices = (draco, decoder, dracoGeometry) => {
  const numFaces = dracoGeometry.num_faces();
  const numIndices = numFaces * 3;
  const byteLength = numIndices * 4;

  // eslint-disable-next-line no-underscore-dangle
  const ptr = draco._malloc(byteLength);

  decoder.GetTrianglesUInt32Array(dracoGeometry, byteLength, ptr);
  const indices = new Uint32Array(draco.HEAPF32.buffer, ptr, numIndices).slice();

  // eslint-disable-next-line no-underscore-dangle
  draco._free(ptr);

  return indices;
};

const decodePrimitive = (draco, decoder, json, binary, primitive) => {
  const { extensions = {} } = primitive;
  const dracoCompression = extensions.KHR_draco_mesh_compression;
  if (!dracoCompression) {
    return;
  }

  const dracoGeometry = decodeGeometry(draco, decoder, json, binary, dracoCompression);

  dracoCompression.accessors = [];

  const { attributes } = dracoCompression;
  dracoCompression.accessors.push(...decodeAttributes(draco, decoder, dracoGeometry, attributes));

  dracoCompression.accessors.push(decodeIndices(draco, decoder, dracoGeometry));

  draco.destroy(dracoGeometry);
};

export default async function decodeCompressedGLB(json, binary) {
  const { extensionsRequired = [] } = json;
  if (!extensionsRequired.includes("KHR_draco_mesh_compression")) {
    // this model does not uses Draco compression
    return;
  }

  // initialize Draco module and decoder
  const draco = await draco3d.createDecoderModule({
    locateFile: () => {
      return draco3dWasm;
    },
  });
  const decoder = new draco.Decoder();

  json.meshes.forEach((mesh) => {
    mesh.primitives.forEach((primitive) => {
      decodePrimitive(draco, decoder, json, binary, primitive);
    });
  });

  draco.destroy(decoder);
}
