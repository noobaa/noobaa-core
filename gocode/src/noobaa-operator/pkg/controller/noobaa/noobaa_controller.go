package noobaa

import (
	"context"
	"os"

	noobaav1alpha1 "noobaa-operator/pkg/apis/noobaa/v1alpha1"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/yaml"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var log = logf.Log.WithName("controller_noobaa")

/**
* USER ACTION REQUIRED: This is a scaffold file intended for the user to modify with their own Controller
* business logic.  Delete these comments after modifying this file.*
 */

// Add creates a new Noobaa Controller and adds it to the Manager. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	return add(mgr, newReconciler(mgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager) reconcile.Reconciler {
	return &ReconcileNoobaa{client: mgr.GetClient(), scheme: mgr.GetScheme()}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	// Create a new controller
	c, err := controller.New("noobaa-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to primary resource Noobaa
	err = c.Watch(&source.Kind{Type: &noobaav1alpha1.Noobaa{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	// TODO(user): Modify this to be the types you create that are owned by the primary resource
	// Watch for changes to secondary resource Pods and requeue the owner Noobaa
	err = c.Watch(&source.Kind{Type: &corev1.Pod{}}, &handler.EnqueueRequestForOwner{
		IsController: true,
		OwnerType:    &noobaav1alpha1.Noobaa{},
	})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileNoobaa{}

// ReconcileNoobaa reconciles a Noobaa object
type ReconcileNoobaa struct {
	// This client, initialized using mgr.Client() above, is a split client
	// that reads objects from the cache and writes to the apiserver
	client client.Client
	scheme *runtime.Scheme
}

// Reconcile reads that state of the cluster for a Noobaa object and makes changes based on the state read
// and what is in the Noobaa.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  This example creates
// a Pod as an example
// Note:
// The Controller will requeue the Request to be processed again if the returned error is non-nil or
// Result.Requeue is true, otherwise upon completion it will remove the work from the queue.
func (r *ReconcileNoobaa) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	reqLogger := log.WithValues("Request.Namespace", request.Namespace, "Request.Name", request.Name)
	reqLogger.Info("Reconciling Noobaa")

	// Fetch the Noobaa instance
	nb := &noobaav1alpha1.Noobaa{}
	err := r.client.Get(context.TODO(), request.NamespacedName, nb)
	if err != nil {
		if errors.IsNotFound(err) {
			// Request object not found, could have been deleted after reconcile request.
			// Owned objects are automatically garbage collected. For additional cleanup logic use finalizers.
			// Return and don't requeue
			reqLogger.Error(err, "could not find noobaa instance. might be deleted")
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		reqLogger.Error(err, "could not get noobaa instance")
		return reconcile.Result{}, err
	}

	requeueAccount, accountErr := r.reconcileNoobaaAccount(nb)
	if accountErr != nil {
		reqLogger.Error(err, "failed reconciling noobaa account")
	}

	requeueRole, roleErr := r.reconcileNoobaaRole(nb)
	if roleErr != nil {
		reqLogger.Error(err, "failed reconciling noobaa role")
	}

	requeueRoleBind, roleBindErr := r.reconcileNoobaaRoleBinding(nb)
	if roleBindErr != nil {
		reqLogger.Error(err, "failed reconciling noobaa role binding")
	}

	requeStateful, statefulsetErr := r.reconcileStatfulset(nb)
	if statefulsetErr != nil {
		reqLogger.Error(err, "failed reconciling noobaa statefulset")
	}

	requeService, serviceErr := r.reconcileService(nb)
	if serviceErr != nil {
		reqLogger.Error(err, "failed reconciling noobaa service")
	}

	if statefulsetErr != nil {
		return reconcile.Result{}, statefulsetErr
	}
	if serviceErr != nil {
		return reconcile.Result{}, statefulsetErr
	}

	reque := requeService || requeStateful || requeueAccount || requeueRole || requeueRoleBind

	// noobaa statefulset and service already exists - don't requeue
	// reqLogger.Info("Skip reconcile: resources already exists", "StatefulSet.Namespace", found.Namespace, "Pod.Name", found.Name)
	return reconcile.Result{Requeue: reque}, nil
}

func (r *ReconcileNoobaa) reconcileNoobaaAccount(nb *noobaav1alpha1.Noobaa) (requeue bool, err error) {
	noobaaAccount := &corev1.ServiceAccount{}
	err = r.client.Get(context.TODO(), types.NamespacedName{Name: "noobaa-account", Namespace: nb.Namespace}, noobaaAccount)
	if err != nil && errors.IsNotFound(err) {
		// Define a new deployment
		nbAccount := &corev1.ServiceAccount{}
		nbAccount.ObjectMeta.Name = "noobaa-account"
		nbAccount.ObjectMeta.Namespace = nb.Namespace
		log.Info("Creating noobaa-account", "account.Namespace", nb.Namespace, "Name", "noobaa-account")
		err = r.client.Create(context.TODO(), nbAccount)
		if err != nil {
			log.Error(err, "Failed to create new account", "account.Namespace", nb.Namespace, "Name", "noobaa-account")
			return true, err
		}
		return true, nil
	} else if err != nil {
		log.Error(err, "Failed to get account")
		return true, err
	}
	return false, nil
}

func (r *ReconcileNoobaa) reconcileNoobaaRole(nb *noobaav1alpha1.Noobaa) (requeue bool, err error) {
	noobaaRole := &rbacv1.Role{}
	err = r.client.Get(context.TODO(), types.NamespacedName{Name: "noobaa-role", Namespace: nb.Namespace}, noobaaRole)
	if err != nil && errors.IsNotFound(err) {
		// Define a new deployment
		nbRole, err := r.roleForNoobaa(nb)
		log.Info("Creating noobaa-role", "account.Namespace", nb.Namespace, "Name", nbRole.ObjectMeta.Name)
		err = r.client.Create(context.TODO(), nbRole)
		if err != nil {
			log.Error(err, "Failed to create new role", "role.Namespace", nb.Namespace, "Name", nbRole.ObjectMeta.Name)
			return true, err
		}
		return true, nil
	} else if err != nil {
		log.Error(err, "Failed to get role")
		return true, err
	}
	return false, nil
}

func (r *ReconcileNoobaa) reconcileNoobaaRoleBinding(nb *noobaav1alpha1.Noobaa) (requeue bool, err error) {
	noobaaRoleBind := &rbacv1.RoleBinding{}
	err = r.client.Get(context.TODO(), types.NamespacedName{Name: "noobaa-role-binding", Namespace: nb.Namespace}, noobaaRoleBind)
	if err != nil && errors.IsNotFound(err) {
		// Define a new deployment
		nbRoleBind, err := r.roleBindForNoobaa(nb)
		log.Info("Creating noobaa-role-binding", "account.Namespace", nb.Namespace, "Name", nbRoleBind.ObjectMeta.Name)
		err = r.client.Create(context.TODO(), nbRoleBind)
		if err != nil {
			log.Error(err, "Failed to create new role binding", "role.Namespace", nb.Namespace, "Name", nbRoleBind.ObjectMeta.Name)
			return true, err
		}
		return true, nil
	} else if err != nil {
		log.Error(err, "Failed to get role")
		return true, err
	}
	return false, nil
}

func (r *ReconcileNoobaa) reconcileStatfulset(nb *noobaav1alpha1.Noobaa) (requeue bool, err error) {
	// Check if the noobaa's stateful-set is already exist. if not create it
	noobaaStateful := &appsv1.StatefulSet{}
	log.Info("Getting noobaa StatefulSet", "Namespace", nb.Namespace, "StatefulSet Name", nb.Name)
	err = r.client.Get(context.TODO(), types.NamespacedName{Name: nb.Name, Namespace: nb.Namespace}, noobaaStateful)
	if err != nil && errors.IsNotFound(err) {
		// Define a new deployment
		statefulSet, err := r.statefulSetForNoobaa(nb)
		if err != nil {
			log.Error(err, "failed getting stateful set for noobaa")
			return true, err
		}
		log.Info("Creating a new StatefulSet", "StatefulSet.Namespace", statefulSet.Namespace, "StatefulSet.Name", statefulSet.Name)
		err = r.client.Create(context.TODO(), statefulSet)
		if err != nil {
			log.Error(err, "Failed to create new StatefulSet", "StatefulSet.Namespace", statefulSet.Namespace, "StatefulSet.Name", statefulSet.Name)
			return true, err
		}
		return true, nil
	} else if err != nil {
		log.Error(err, "Failed to get StatefulSet")
		return true, err
	}
	currImage := noobaaStateful.Spec.Template.Spec.Containers[0].Image
	currVer := currImage[len(currImage)-7:]
	if nb.Spec.Version != "" && currVer != "" && nb.Spec.Version != currVer {
		noobaaStateful.Spec.Template.Spec.Containers[0].Image = "noobaaimages.azurecr.io/noobaa/nbserver:" + nb.Spec.Version
		log.Info("updating statefulset to new noobaa version", "old version", currVer, "new version", nb.Spec.Version)
		err = r.updateNoobaaStatefulset(noobaaStateful)
		if err != nil {
			return true, err
		}
		return true, nil
	}
	if nb.Spec.Image != "" && currImage != "" && nb.Spec.Image != currImage {
		noobaaStateful.Spec.Template.Spec.Containers[0].Image = nb.Spec.Image
		log.Info("updating statefulset to new noobaa version", "old image", currImage, "new image", nb.Spec.Image)
		err = r.updateNoobaaStatefulset(noobaaStateful)
		if err != nil {
			return true, err
		}
		return true, nil
	}
	log.Info("reconcile statefulset:", "found", noobaaStateful)
	return false, nil
}

func (r *ReconcileNoobaa) updateNoobaaStatefulset(noobaaStateful *appsv1.StatefulSet) error {
	err := r.client.Update(context.TODO(), noobaaStateful)
	if err != nil {
		log.Error(err, "failed to update noobaa statefulset")
		return err
	}
	// delete old noobaa pod
	noobaaPod := &corev1.Pod{}
	r.client.Get(context.TODO(), types.NamespacedName{Name: noobaaStateful.Name + "-0", Namespace: noobaaStateful.Namespace}, noobaaPod)
	if err != nil {
		log.Error(err, "failed to get old noobaa pod")
		return err
	}
	err = r.client.Delete(context.TODO(), noobaaPod)
	if err != nil {
		log.Error(err, "failed to delete old noobaa pod")
		return err
	}
	return nil
}

func (r *ReconcileNoobaa) reconcileService(nb *noobaav1alpha1.Noobaa) (requeue bool, err error) {
	noobaaService := &corev1.Service{}
	log.Info("Getting noobaa Services", "Namespace", nb.Namespace, "Service Name", "s3")
	err = r.client.Get(context.TODO(), types.NamespacedName{Name: "s3", Namespace: nb.Namespace}, noobaaService)
	if err != nil && errors.IsNotFound(err) {
		// Define a new deployment
		service, err := r.serviceForNoobaa(nb)
		if err != nil {
			log.Error(err, "failed getting service for noobaa")
			return true, err
		}
		log.Info("Creating a new service", "service.Namespace", service.Namespace, "service.Name", service.Name)
		err = r.client.Create(context.TODO(), service)
		if err != nil {
			log.Error(err, "Failed to create new service", "service.Namespace", service.Namespace, "service.Name", service.Name)
			return true, err
		}
		// service created successfully - return and requeue
		return true, nil
	} else if err != nil {
		log.Error(err, "Failed to get service")
		return true, err
	}
	return false, nil
}

// deploymentForMemcached returns a memcached Deployment object
func (r *ReconcileNoobaa) statefulSetForNoobaa(nb *noobaav1alpha1.Noobaa) (*appsv1.StatefulSet, error) {
	ls := labelsForNoobaa(nb.Name)
	statefulSet := &appsv1.StatefulSet{}
	err := readResourceFromYaml("noobaa-server", statefulSet)
	if err != nil {
		log.Error(err, "failed reading stateful set yaml")
		return nil, err
	}
	statefulSet.ObjectMeta.Namespace = nb.Namespace
	statefulSet.ObjectMeta.Name = nb.Name
	// statefulSet.Spec.ServiceName = "s3"
	statefulSet.Spec.Template.ObjectMeta.Labels = ls
	if nb.Spec.Image != "" {
		statefulSet.Spec.Template.Spec.Containers[0].Image = nb.Spec.Image
	}
	if nb.Spec.Version != "" {
		statefulSet.Spec.Template.Spec.Containers[0].Image = "noobaaimages.azurecr.io/noobaa/nbserver:" + nb.Spec.Version
	}
	if nb.Spec.Email != "" && nb.Spec.ActivationCode != "" {
		statefulSet.Spec.Template.Spec.Containers[0].Env = []corev1.EnvVar{
			corev1.EnvVar{Name: "CREATE_SYS_NAME", Value: nb.Name},
			corev1.EnvVar{Name: "CREATE_SYS_EMAIL", Value: nb.Spec.Email},
			corev1.EnvVar{Name: "CREATE_SYS_CODE", Value: nb.Spec.ActivationCode},
			corev1.EnvVar{Name: "CONTAINER_PLATFORM", Value: "KUBERNETES"},
		}
	}

	controllerutil.SetControllerReference(nb, statefulSet, r.scheme)
	return statefulSet, nil
}

// deploymentForMemcached returns a memcached Deployment object
func (r *ReconcileNoobaa) serviceForNoobaa(nb *noobaav1alpha1.Noobaa) (*corev1.Service, error) {
	ls := labelsForNoobaa(nb.Name)
	service := &corev1.Service{}
	err := readResourceFromYaml("s3", service)
	if err != nil {
		log.Error(err, "failed reading service yaml")
		return nil, err
	}

	service.ObjectMeta.Namespace = nb.Namespace
	service.ObjectMeta.Labels = ls
	service.Spec.Selector = ls

	controllerutil.SetControllerReference(nb, service, r.scheme)
	return service, nil
}

// deploymentForMemcached returns a memcached Deployment object
func (r *ReconcileNoobaa) roleForNoobaa(nb *noobaav1alpha1.Noobaa) (*rbacv1.Role, error) {
	role := &rbacv1.Role{}
	err := readResourceFromYaml("noobaa-role", role)
	if err != nil {
		log.Error(err, "failed reading role yaml")
		return nil, err
	}

	role.ObjectMeta.Namespace = nb.Namespace
	return role, nil
}

// deploymentForMemcached returns a memcached Deployment object
func (r *ReconcileNoobaa) roleBindForNoobaa(nb *noobaav1alpha1.Noobaa) (*rbacv1.RoleBinding, error) {
	roleBind := &rbacv1.RoleBinding{}
	err := readResourceFromYaml("noobaa-role-binding", roleBind)
	if err != nil {
		log.Error(err, "failed reading role binding yaml")
		return nil, err
	}

	roleBind.ObjectMeta.Namespace = nb.Namespace
	return roleBind, nil
}

func readResourceFromYaml(resourceName string, into interface{}) error {
	var yamlPath string
	if os.Getenv("OPERATOR") == "" {
		yamlPath = "./build/"
	} else {
		yamlPath = "/noobaa_yaml/"
	}
	yamlPath = yamlPath + resourceName + ".yaml"
	yamlFile, err := os.Open(yamlPath)
	if err != nil {
		log.Error(err, "failed openning yaml file", "path", yamlPath)
		return err
	}
	decoder := yaml.NewYAMLOrJSONDecoder(yamlFile, 1024)
	if err := decoder.Decode(into); err != nil {
		log.Error(err, "got error on decode")
		return err
	}
	return nil
}

// labelsForNoobaa returns the labels for selecting the resources
// belonging to the given memcached CR name.
func labelsForNoobaa(name string) map[string]string {
	return map[string]string{"app": "noobaa", "noobaa_name": name}
}
