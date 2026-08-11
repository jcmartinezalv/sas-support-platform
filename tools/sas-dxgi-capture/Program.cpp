#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wincodec.h>
#include <wincrypt.h>
#include <objidl.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

struct Options {
  int quality = 62;
  int maxWidth = 1280;
  int monitorIndex = 0;
  bool nativeResolution = false;
};

struct FrameMetrics {
  double meanLuma = 0;
  double lumaStdDev = 0;
  double darkPixelRatio = 1;
  bool blankFrame = true;
};

struct ComInit {
  HRESULT result;
  ComInit() : result(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
  ~ComInit() { if (SUCCEEDED(result)) CoUninitialize(); }
};

template <typename T> static void ReleaseCom(T*& value) {
  if (value) { value->Release(); value = nullptr; }
}

static std::string JsonEscape(const std::string& value) {
  std::ostringstream out;
  for (unsigned char c : value) {
    switch (c) {
      case '\\': out << "\\\\"; break;
      case '"': out << "\\\""; break;
      case '\r': out << "\\r"; break;
      case '\n': out << "\\n"; break;
      case '\t': out << "\\t"; break;
      default:
        if (c < 0x20) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c) << std::dec;
        else out << c;
    }
  }
  return out.str();
}

static std::string Base64Encode(const BYTE* data, DWORD length) {
  DWORD outputLength = 0;
  if (!CryptBinaryToStringA(data, length, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &outputLength)) return {};
  std::string output(outputLength, '\0');
  if (!CryptBinaryToStringA(data, length, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, &output[0], &outputLength)) return {};
  while (!output.empty() && output.back() == '\0') output.pop_back();
  return output;
}

static std::vector<BYTE> Base64Decode(const std::string& value) {
  DWORD length = 0;
  if (!CryptStringToBinaryA(value.c_str(), static_cast<DWORD>(value.size()), CRYPT_STRING_BASE64, nullptr, &length, nullptr, nullptr)) return {};
  std::vector<BYTE> output(length);
  if (!CryptStringToBinaryA(value.c_str(), static_cast<DWORD>(value.size()), CRYPT_STRING_BASE64, output.data(), &length, nullptr, nullptr)) return {};
  output.resize(length);
  return output;
}

static std::string IsoUtcNow() {
  SYSTEMTIME time{};
  GetSystemTime(&time);
  char value[40]{};
  sprintf_s(value, "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond, time.wMilliseconds);
  return value;
}

static std::string HResultMessage(HRESULT result) {
  char* text = nullptr;
  FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
    nullptr, static_cast<DWORD>(result), 0, reinterpret_cast<char*>(&text), 0, nullptr);
  std::ostringstream output;
  output << "HRESULT 0x" << std::hex << std::uppercase << static_cast<unsigned long>(result);
  if (text) { output << ": " << text; LocalFree(text); }
  return output.str();
}

static Options ParseOptions(const std::vector<std::string>& args) {
  Options options;
  for (size_t index = 0; index < args.size(); ++index) {
    const std::string& arg = args[index];
    const std::string next = index + 1 < args.size() ? args[index + 1] : "";
    if (arg == "--quality" && !next.empty()) { options.quality = std::clamp(std::atoi(next.c_str()), 35, 90); ++index; }
    else if (arg == "--max-width" && !next.empty()) { options.maxWidth = std::clamp(std::atoi(next.c_str()), 640, 3840); ++index; }
    else if (arg == "--monitor" && !next.empty()) { options.monitorIndex = std::clamp(std::atoi(next.c_str()), 0, 15); ++index; }
    else if (arg == "--native") options.nativeResolution = true;
  }
  return options;
}

static FrameMetrics MeasureFrame(const std::vector<BYTE>& bgra, UINT width, UINT height) {
  const UINT stepX = std::max(1u, width / 64), stepY = std::max(1u, height / 64);
  size_t count = 0, dark = 0;
  double sum = 0, squares = 0;
  for (UINT y = stepY / 2; y < height; y += stepY) {
    for (UINT x = stepX / 2; x < width; x += stepX) {
      const size_t offset = (static_cast<size_t>(y) * width + x) * 4;
      const double luma = 0.2126 * bgra[offset + 2] + 0.7152 * bgra[offset + 1] + 0.0722 * bgra[offset];
      sum += luma; squares += luma * luma; dark += luma < 8 ? 1 : 0; ++count;
    }
  }
  FrameMetrics metrics;
  metrics.meanLuma = count ? sum / count : 0;
  const double variance = count ? std::max(0.0, squares / count - metrics.meanLuma * metrics.meanLuma) : 0;
  metrics.lumaStdDev = std::sqrt(variance);
  metrics.darkPixelRatio = count ? static_cast<double>(dark) / count : 1;
  metrics.blankFrame = metrics.darkPixelRatio >= 0.995 && metrics.meanLuma <= 3 && metrics.lumaStdDev <= 4;
  return metrics;
}

static void DrawCursor(std::vector<BYTE>& bgra, int width, int height, const RECT& desktop) {
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void* bits = nullptr;
  HDC screenDc = GetDC(nullptr);
  HDC memoryDc = CreateCompatibleDC(screenDc);
  HBITMAP bitmap = CreateDIBSection(screenDc, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
  HGDIOBJ oldObject = bitmap ? SelectObject(memoryDc, bitmap) : nullptr;
  if (bitmap && bits) {
    memcpy(bits, bgra.data(), bgra.size());
    CURSORINFO cursor{};
    cursor.cbSize = sizeof(cursor);
    if (GetCursorInfo(&cursor) && (cursor.flags & CURSOR_SHOWING) && cursor.hCursor) {
      ICONINFO icon{};
      int hotX = 0, hotY = 0;
      if (GetIconInfo(cursor.hCursor, &icon)) {
        hotX = static_cast<int>(icon.xHotspot);
        hotY = static_cast<int>(icon.yHotspot);
        if (icon.hbmMask) DeleteObject(icon.hbmMask);
        if (icon.hbmColor) DeleteObject(icon.hbmColor);
      }
      DrawIconEx(memoryDc, cursor.ptScreenPos.x - desktop.left - hotX, cursor.ptScreenPos.y - desktop.top - hotY,
        cursor.hCursor, 0, 0, 0, nullptr, DI_NORMAL);
    }
    memcpy(bgra.data(), bits, bgra.size());
  }
  if (oldObject) SelectObject(memoryDc, oldObject);
  if (bitmap) DeleteObject(bitmap);
  if (memoryDc) DeleteDC(memoryDc);
  if (screenDc) ReleaseDC(nullptr, screenDc);
}

static HRESULT EncodeJpeg(const std::vector<BYTE>& bgra, UINT sourceWidth, UINT sourceHeight, UINT targetWidth, UINT targetHeight,
  int quality, std::vector<BYTE>& jpeg) {
  IWICImagingFactory* factory = nullptr;
  IWICBitmap* bitmap = nullptr;
  IWICBitmapScaler* scaler = nullptr;
  IWICBitmapSource* source = nullptr;
  IWICBitmapEncoder* encoder = nullptr;
  IWICBitmapFrameEncode* frame = nullptr;
  IPropertyBag2* properties = nullptr;
  IStream* stream = nullptr;
  HRESULT result = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory));
  if (SUCCEEDED(result)) result = factory->CreateBitmapFromMemory(sourceWidth, sourceHeight, GUID_WICPixelFormat32bppBGRA,
    sourceWidth * 4, static_cast<UINT>(bgra.size()), const_cast<BYTE*>(bgra.data()), &bitmap);
  if (SUCCEEDED(result) && (sourceWidth != targetWidth || sourceHeight != targetHeight)) {
    result = factory->CreateBitmapScaler(&scaler);
    if (SUCCEEDED(result)) result = scaler->Initialize(bitmap, targetWidth, targetHeight, WICBitmapInterpolationModeFant);
    source = scaler;
  } else source = bitmap;
  if (source) source->AddRef();
  if (SUCCEEDED(result)) result = CreateStreamOnHGlobal(nullptr, TRUE, &stream);
  if (SUCCEEDED(result)) result = factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &encoder);
  if (SUCCEEDED(result)) result = encoder->Initialize(stream, WICBitmapEncoderNoCache);
  if (SUCCEEDED(result)) result = encoder->CreateNewFrame(&frame, &properties);
  if (SUCCEEDED(result) && properties) {
    PROPBAG2 option{};
    option.pstrName = const_cast<LPOLESTR>(L"ImageQuality");
    VARIANT value{};
    VariantInit(&value);
    value.vt = VT_R4;
    value.fltVal = static_cast<float>(quality) / 100.0f;
    properties->Write(1, &option, &value);
    VariantClear(&value);
  }
  if (SUCCEEDED(result)) result = frame->Initialize(properties);
  if (SUCCEEDED(result)) result = frame->SetSize(targetWidth, targetHeight);
  WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
  if (SUCCEEDED(result)) result = frame->SetPixelFormat(&format);
  if (SUCCEEDED(result)) result = frame->WriteSource(source, nullptr);
  if (SUCCEEDED(result)) result = frame->Commit();
  if (SUCCEEDED(result)) result = encoder->Commit();
  if (SUCCEEDED(result)) {
    HGLOBAL global = nullptr;
    result = GetHGlobalFromStream(stream, &global);
    if (SUCCEEDED(result)) {
      const SIZE_T size = GlobalSize(global);
      const void* data = GlobalLock(global);
      if (!data || !size) result = E_FAIL;
      else { jpeg.assign(static_cast<const BYTE*>(data), static_cast<const BYTE*>(data) + size); GlobalUnlock(global); }
    }
  }
  ReleaseCom(source); ReleaseCom(properties); ReleaseCom(frame); ReleaseCom(encoder); ReleaseCom(stream); ReleaseCom(scaler); ReleaseCom(bitmap); ReleaseCom(factory);
  return result;
}

static HRESULT CaptureDxgi(const Options& options, std::string& json) {
  D3D_FEATURE_LEVEL featureLevel{};
  ID3D11Device* device = nullptr;
  ID3D11DeviceContext* context = nullptr;
  IDXGIDevice* dxgiDevice = nullptr;
  IDXGIAdapter* adapter = nullptr;
  IDXGIOutput* output = nullptr;
  IDXGIOutput1* output1 = nullptr;
  IDXGIOutputDuplication* duplication = nullptr;
  IDXGIResource* resource = nullptr;
  ID3D11Texture2D* texture = nullptr;
  ID3D11Texture2D* staging = nullptr;
  DXGI_OUTPUT_DESC outputDescription{};
  int monitorCount = 0;
  HRESULT result = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    nullptr, 0, D3D11_SDK_VERSION, &device, &featureLevel, &context);
  if (SUCCEEDED(result)) result = device->QueryInterface(IID_PPV_ARGS(&dxgiDevice));
  if (SUCCEEDED(result)) result = dxgiDevice->GetAdapter(&adapter);
  if (SUCCEEDED(result)) {
    for (UINT index = 0; ; ++index) {
      IDXGIOutput* candidate = nullptr;
      const HRESULT enumerate = adapter->EnumOutputs(index, &candidate);
      ReleaseCom(candidate);
      if (enumerate == DXGI_ERROR_NOT_FOUND) break;
      if (FAILED(enumerate)) { result = enumerate; break; }
      ++monitorCount;
    }
  }
  if (SUCCEEDED(result)) result = adapter->EnumOutputs(static_cast<UINT>(options.monitorIndex), &output);
  if (SUCCEEDED(result)) result = output->GetDesc(&outputDescription);
  if (SUCCEEDED(result)) result = output->QueryInterface(IID_PPV_ARGS(&output1));
  if (SUCCEEDED(result)) result = output1->DuplicateOutput(device, &duplication);
  DXGI_OUTDUPL_FRAME_INFO frameInfo{};
  if (SUCCEEDED(result)) {
    for (int attempt = 0; attempt < 3; ++attempt) {
      result = duplication->AcquireNextFrame(500, &frameInfo, &resource);
      if (result != DXGI_ERROR_WAIT_TIMEOUT) break;
    }
  }
  if (SUCCEEDED(result)) result = resource->QueryInterface(IID_PPV_ARGS(&texture));
  D3D11_TEXTURE2D_DESC description{};
  if (SUCCEEDED(result)) {
    texture->GetDesc(&description);
    D3D11_TEXTURE2D_DESC stagingDescription = description;
    stagingDescription.Usage = D3D11_USAGE_STAGING;
    stagingDescription.BindFlags = 0;
    stagingDescription.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    stagingDescription.MiscFlags = 0;
    result = device->CreateTexture2D(&stagingDescription, nullptr, &staging);
  }
  D3D11_MAPPED_SUBRESOURCE mapped{};
  bool mappedTexture = false;
  std::vector<BYTE> bgra;
  if (SUCCEEDED(result)) {
    context->CopyResource(staging, texture);
    result = context->Map(staging, 0, D3D11_MAP_READ, 0, &mapped);
    mappedTexture = SUCCEEDED(result);
  }
  if (SUCCEEDED(result)) {
    bgra.resize(static_cast<size_t>(description.Width) * description.Height * 4);
    for (UINT row = 0; row < description.Height; ++row)
      memcpy(bgra.data() + static_cast<size_t>(row) * description.Width * 4,
        static_cast<const BYTE*>(mapped.pData) + static_cast<size_t>(row) * mapped.RowPitch, description.Width * 4);
    context->Unmap(staging, 0);
    mappedTexture = false;
    const FrameMetrics metrics = MeasureFrame(bgra, description.Width, description.Height);
    DrawCursor(bgra, static_cast<int>(description.Width), static_cast<int>(description.Height), outputDescription.DesktopCoordinates);
    const double scale = options.nativeResolution ? 1.0 : std::min(1.0, static_cast<double>(options.maxWidth) / description.Width);
    const UINT targetWidth = std::max(1u, static_cast<UINT>(description.Width * scale + 0.5));
    const UINT targetHeight = std::max(1u, static_cast<UINT>(description.Height * scale + 0.5));
    std::vector<BYTE> jpeg;
    result = EncodeJpeg(bgra, description.Width, description.Height, targetWidth, targetHeight, options.quality, jpeg);
    if (SUCCEEDED(result)) {
      std::ostringstream out;
      out << "{\"ok\":true,\"captureEngine\":\"dxgi_desktop_duplication\",\"mimeType\":\"image/jpeg\",\"imageBase64\":\""
          << Base64Encode(jpeg.data(), static_cast<DWORD>(jpeg.size())) << "\",\"width\":" << targetWidth << ",\"height\":" << targetHeight
          << ",\"nativeWidth\":" << description.Width << ",\"nativeHeight\":" << description.Height
          << ",\"monitorOriginX\":" << outputDescription.DesktopCoordinates.left << ",\"monitorOriginY\":" << outputDescription.DesktopCoordinates.top
          << ",\"monitorIndex\":" << options.monitorIndex << ",\"monitorCount\":" << monitorCount << ",\"quality\":" << options.quality << ",\"maxWidth\":" << options.maxWidth
          << ",\"frameMetrics\":{\"meanLuma\":" << std::fixed << std::setprecision(3) << metrics.meanLuma << ",\"lumaStdDev\":" << metrics.lumaStdDev << ",\"darkPixelRatio\":" << std::setprecision(5) << metrics.darkPixelRatio << "},\"blankFrame\":" << (metrics.blankFrame ? "true" : "false")
          << ",\"cursorEmbedded\":true,\"capturedAt\":\"" << IsoUtcNow() << "\",\"error\":null}";
      json = out.str();
    }
  }
  if (mappedTexture) context->Unmap(staging, 0);
  if (duplication && resource) duplication->ReleaseFrame();
  ReleaseCom(staging); ReleaseCom(texture); ReleaseCom(resource); ReleaseCom(duplication); ReleaseCom(output1); ReleaseCom(output); ReleaseCom(adapter); ReleaseCom(dxgiDevice); ReleaseCom(context); ReleaseCom(device);
  return result;
}

static int Run(const std::vector<std::string>& args) {
  ComInit com;
  if (FAILED(com.result) && com.result != RPC_E_CHANGED_MODE) {
    std::cout << "{\"ok\":false,\"captureEngine\":\"dxgi_desktop_duplication\",\"error\":\"COM initialization failed\"}" << std::endl;
    return 1;
  }
  const Options options = ParseOptions(args);
  std::string json;
  const HRESULT result = CaptureDxgi(options, json);
  if (FAILED(result)) {
    const std::string message = HResultMessage(result);
    std::cout << "{\"ok\":false,\"captureEngine\":\"dxgi_desktop_duplication\",\"error\":\"" << JsonEscape(message) << "\"}" << std::endl;
    return 1;
  }
  std::cout << json << std::endl;
  return 0;
}

int main(int argc, char** argv) {
  SetConsoleOutputCP(CP_UTF8);
  if (argc > 1 && std::string(argv[1]) == "--server") {
    std::string line;
    while (std::getline(std::cin, line)) {
      if (line.empty()) continue;
      const std::vector<BYTE> decoded = Base64Decode(line);
      std::vector<std::string> args;
      size_t start = 0;
      for (size_t index = 0; index <= decoded.size(); ++index) {
        if (index == decoded.size() || decoded[index] == 0) {
          args.emplace_back(reinterpret_cast<const char*>(decoded.data() + start), index - start);
          start = index + 1;
        }
      }
      Run(args);
    }
    return 0;
  }
  std::vector<std::string> args;
  for (int index = 1; index < argc; ++index) args.emplace_back(argv[index]);
  return Run(args);
}
