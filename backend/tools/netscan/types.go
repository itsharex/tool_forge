// Package netscan 提供网络相关的探测工具:SSL 证书检查 / DNS 查询 / WHOIS / 端口检测。
// 这些功能各自小但放在一起作为开发者排查网络问题的"瑞士军刀"。
package netscan

// ============= SSL 证书 =============

type SSLCertificate struct {
	Subject            string   `json:"subject"`
	Issuer             string   `json:"issuer"`
	CommonName         string   `json:"commonName"`
	NotBefore          string   `json:"notBefore"`     // RFC3339
	NotAfter           string   `json:"notAfter"`      // RFC3339
	DaysRemaining      int      `json:"daysRemaining"` // 距离过期还有多少天,负数表示已过期
	SerialNumber       string   `json:"serialNumber"`
	SignatureAlgorithm string   `json:"signatureAlgorithm"`
	PublicKeyAlgorithm string   `json:"publicKeyAlgorithm"`
	DNSNames           []string `json:"dnsNames"`
	IPAddresses        []string `json:"ipAddresses"`
	IsCA               bool     `json:"isCA"`
	Version            int      `json:"version"`
}

type SSLResult struct {
	Host        string           `json:"host"`
	Port        int              `json:"port"`
	Protocol    string           `json:"protocol"` // TLS 1.2 / 1.3
	CipherSuite string           `json:"cipherSuite"`
	Chain       []SSLCertificate `json:"chain"`
	ChainValid  bool             `json:"chainValid"` // 系统根证书能验签
	HostnameOK  bool             `json:"hostnameOK"` // 证书包含请求的 hostname
	Error       string           `json:"error,omitempty"`
}

// ============= DNS =============

type DNSRecord struct {
	Type  string `json:"type"`
	Value string `json:"value"`
	TTL   int    `json:"ttl,omitempty"` // 部分类型给不出
}

type DNSResult struct {
	Domain  string      `json:"domain"`
	Records []DNSRecord `json:"records"`
	Error   string      `json:"error,omitempty"`
}

// ============= WHOIS =============

type WhoisResult struct {
	Domain string            `json:"domain"`
	Server string            `json:"server"`
	Raw    string            `json:"raw"`
	Parsed map[string]string `json:"parsed"` // Registrar / Registrar URL / Updated Date / Creation Date / Expiry Date / Name Server / Status 等
	Error  string            `json:"error,omitempty"`
}

// ============= 端口检测 =============

type PortStatus struct {
	Port    int    `json:"port"`
	Open    bool   `json:"open"`
	Latency int    `json:"latency"` // ms
	Error   string `json:"error,omitempty"`
}

type PortResult struct {
	Host  string       `json:"host"`
	Ports []PortStatus `json:"ports"`
	Error string       `json:"error,omitempty"`
}
