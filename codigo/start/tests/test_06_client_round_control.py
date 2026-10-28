import types
import unittest
from unittest import mock

import numpy as np

from tests.utils import DummyContextManager, load_student_client_module


class TestClientRoundControl(unittest.TestCase):
    def setUp(self):
        self.client = load_student_client_module("student_client_round_control")
        self.params = [np.zeros((3, 4)), np.zeros(3)]

    def global_model(self, round_number=1, done=False):
        return self.client.federated_pb2.GlobalModel(
            round=round_number,
            total_rounds=2,
            done=done,
            model=self.client.params_to_proto(self.params),
        )

    def run_with_stub(self, stub):
        with mock.patch.object(
            self.client, "load_client_partition",
            return_value=(np.zeros((4, 4)), np.array([0, 1, 0, 1]), None, None),
        ), mock.patch.object(
            self.client, "create_model_template", return_value=object(),
        ), mock.patch.object(
            self.client.grpc, "insecure_channel",
            return_value=DummyContextManager(object()),
        ), mock.patch.object(
            self.client.federated_pb2_grpc, "FederatedLearningStub", return_value=stub,
        ), mock.patch.object(
            self.client, "local_train",
            return_value={"params": self.params, "num_examples": 4, "train_loss": 0.4, "train_acc": 0.75},
        ) as train, mock.patch.object(self.client.time, "sleep"):
            self.client.run_client(0, "server:50051", 2, 0.0, 1)
        return train

    def test_accepted_round_is_not_trained_again_while_waiting(self):
        stub = mock.Mock()
        stub.GetGlobalModel.side_effect = [
            self.global_model(), self.global_model(), self.global_model(2, True),
        ]
        stub.SubmitUpdate.return_value = types.SimpleNamespace(accepted=True)
        train = self.run_with_stub(stub)
        self.assertEqual(train.call_count, 1)
        self.assertEqual(stub.SubmitUpdate.call_count, 1)
        self.assertEqual(stub.GetGlobalModel.call_count, 3)

    def test_rejected_round_is_not_marked_completed(self):
        stub = mock.Mock()
        stub.GetGlobalModel.side_effect = [
            self.global_model(), self.global_model(), self.global_model(2, True),
        ]
        stub.SubmitUpdate.side_effect = [
            types.SimpleNamespace(accepted=False, message="recusada"),
            types.SimpleNamespace(accepted=True),
        ]
        train = self.run_with_stub(stub)
        self.assertEqual(train.call_count, 2)
        self.assertEqual(stub.SubmitUpdate.call_count, 2)

    def rpc_error(self, status):
        error = self.client.grpc.RpcError()
        error.code = lambda: status
        return error

    def test_unavailable_during_get_ends_without_training(self):
        stub = mock.Mock()
        stub.GetGlobalModel.side_effect = self.rpc_error(self.client.grpc.StatusCode.UNAVAILABLE)
        train = self.run_with_stub(stub)
        train.assert_not_called()
        stub.SubmitUpdate.assert_not_called()

    def test_unavailable_during_submit_ends_client(self):
        stub = mock.Mock()
        stub.GetGlobalModel.return_value = self.global_model()
        stub.SubmitUpdate.side_effect = self.rpc_error(self.client.grpc.StatusCode.UNAVAILABLE)
        self.run_with_stub(stub)
        stub.GetGlobalModel.assert_called_once()
        stub.SubmitUpdate.assert_called_once()

    def test_other_rpc_errors_are_propagated(self):
        stub = mock.Mock()
        stub.GetGlobalModel.side_effect = self.rpc_error(self.client.grpc.StatusCode.INTERNAL)
        with self.assertRaises(self.client.grpc.RpcError):
            self.run_with_stub(stub)

    def test_cancelled_poll_after_last_accepted_round_is_retried(self):
        stub = mock.Mock()
        stub.GetGlobalModel.side_effect = [
            self.global_model(2),
            self.rpc_error(self.client.grpc.StatusCode.CANCELLED),
            self.global_model(3, True),
        ]
        stub.SubmitUpdate.return_value = types.SimpleNamespace(accepted=True)
        train = self.run_with_stub(stub)
        train.assert_called_once()
        self.assertEqual(stub.GetGlobalModel.call_count, 3)

    def test_cancelled_poll_before_last_round_is_propagated(self):
        stub = mock.Mock()
        stub.GetGlobalModel.side_effect = [
            self.global_model(1),
            self.rpc_error(self.client.grpc.StatusCode.CANCELLED),
        ]
        stub.SubmitUpdate.return_value = types.SimpleNamespace(accepted=True)
        with self.assertRaises(self.client.grpc.RpcError):
            self.run_with_stub(stub)
