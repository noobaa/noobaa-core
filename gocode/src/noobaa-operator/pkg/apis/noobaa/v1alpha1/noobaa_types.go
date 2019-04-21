package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// EDIT THIS FILE!  THIS IS SCAFFOLDING FOR YOU TO OWN!
// NOTE: json tags are required.  Any new fields you add must have json tags for the fields to be serialized.

// NoobaaSpec defines the desired state of Noobaa
// +k8s:openapi-gen=true
type NoobaaSpec struct {

	// Optional: use a specific image for noobaa-server pods
	Image string `json:"image"`

	// version for noobaa-server. if current pod is not in this version than update the server
	Version string `json:"version"`

	// Email and initial password for system creation
	Email    string `json:"email"`
	Password string `json:"password"`
}

// NoobaaStatus defines the observed state of Noobaa
// +k8s:openapi-gen=true
type NoobaaStatus struct {
	// INSERT ADDITIONAL STATUS FIELD - define observed state of cluster
	// Important: Run "operator-sdk generate k8s" to regenerate code after modifying this file
	// Add custom validation using kubebuilder tags: https://book.kubebuilder.io/beyond_basics/generating_crd.html
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// Noobaa is the Schema for the noobaas API
// +k8s:openapi-gen=true
type Noobaa struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   NoobaaSpec   `json:"spec,omitempty"`
	Status NoobaaStatus `json:"status,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// NoobaaList contains a list of Noobaa
type NoobaaList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Noobaa `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Noobaa{}, &NoobaaList{})
}
